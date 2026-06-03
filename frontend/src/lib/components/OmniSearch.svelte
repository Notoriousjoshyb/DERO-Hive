<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { appState } from '../stores/appState.js';
  import { recentSearchesKey, migrateLegacyExplorerSearchStorage } from '../recentSearchStorage.js';
  import { GetNameSuggestions, ResolveDeroName, SearchApps, SearchByKey, SearchByValue, SearchCodeLine, FilterSearchResults, GetAllClasses, GetSCIDsByClass, GetSCIDsByTag } from '../../../wailsjs/go/main/App.js';
  import { Blocks, Zap, FileText, Globe, User, Search, Link, Package, Key, Database, Code } from 'lucide-svelte';
  
  export let placeholder = 'Search blocks, transactions, addresses, smart contracts...';
  export let value = '';
  export let loading = false;
  export let compact = false;
  export let autofocus = false;
  export let showSuggestionsDropdown = true; // Can disable suggestions
  
  const dispatch = createEventDispatcher();
  
  let inputElement;
  let focused = false;
  let suggestions = [];
  let recentSearches = [];
  let selectedIndex = -1;
  let showSuggestions = false;
  let debounceTimer;
  let mountedAt = 0;
  let initialFocusSkipped = false;
  
  // Input type detection
  $: detectedType = detectInputType(value);
  
  function omniNetwork() {
    return get(appState)?.network || 'mainnet';
  }
  
  // Load recent searches from localStorage
  onMount(() => {
    mountedAt = Date.now();
    loadRecentSearches();
  });
  
  function loadRecentSearches() {
    migrateLegacyExplorerSearchStorage();
    try {
      const stored = localStorage.getItem(recentSearchesKey(omniNetwork()));
      if (stored) {
        recentSearches = JSON.parse(stored).slice(0, 8);
      } else {
        recentSearches = [];
      }
    } catch (e) {
      recentSearches = [];
    }
  }
  
  $: $appState.network, loadRecentSearches();
  
  // Fetch suggestions when input changes
  async function fetchSuggestions(query) {
    if (!showSuggestionsDropdown) return;
    
    const trimmed = (query || '').trim();
    
    // Show recent searches when empty and focused
    if (!trimmed && focused) {
      suggestions = recentSearches.map(s => ({
        type: 'recent',
        icon: getTypeIcon(s.type),
        label: s.query.length > 30 ? s.query.slice(0, 15) + '...' + s.query.slice(-12) : s.query,
        value: s.query,
        hint: 'Recent',
        searchType: s.type
      }));
      showSuggestions = suggestions.length > 0;
      return;
    }
    
    // Try DERO Name Resolution first (Phase 3)
    const isNameQuery = /\.dero$/i.test(trimmed) || 
        (/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/i.test(trimmed) && !trimmed.toLowerCase().startsWith('dero'));
    
    if (isNameQuery) {
      try {
        const nameResult = await ResolveDeroName(trimmed);
        if (nameResult.success && nameResult.address) {
          suggestions = [{
            type: 'name',
            icon: 'user',
            label: `${trimmed} → ${nameResult.address.slice(0, 12)}...`,
            value: nameResult.address,
            hint: 'NRS',
            resolved: nameResult.address
          }];
        }
      } catch (e) {
        // Name resolution failed, continue with other suggestions
      }
    }
    
    // Specialized search: key:, value:, code: prefixes
    const lowerTrimmed = trimmed.toLowerCase();
    if (lowerTrimmed.startsWith('key:') && trimmed.length > 4) {
      const keyQuery = trimmed.slice(4).trim();
      if (keyQuery) {
        try {
          const result = await SearchByKey(keyQuery);
          if (result.success && result.results) {
            const filtered = await FilterSearchResults(result.results);
            const keySuggestions = (filtered || result.results).slice(0, 6).map(r => ({
              type: 'key-result',
              icon: 'scid',
              label: r.name || r.scid?.slice(0, 16) + '...',
              value: r.scid || r,
              hint: `Key: ${keyQuery}`,
              scid: r.scid || r,
              resultData: r
            }));
            suggestions = [...suggestions, ...keySuggestions];
          }
        } catch (e) { /* continue */ }
      }
    } else if (lowerTrimmed.startsWith('value:') && trimmed.length > 6) {
      const valQuery = trimmed.slice(6).trim();
      if (valQuery) {
        try {
          const result = await SearchByValue(valQuery);
          if (result.success && result.results) {
            const filtered = await FilterSearchResults(result.results);
            const valSuggestions = (filtered || result.results).slice(0, 6).map(r => ({
              type: 'value-result',
              icon: 'scid',
              label: r.name || r.scid?.slice(0, 16) + '...',
              value: r.scid || r,
              hint: `Value: ${valQuery}`,
              scid: r.scid || r,
              resultData: r
            }));
            suggestions = [...suggestions, ...valSuggestions];
          }
        } catch (e) { /* continue */ }
      }
    } else if ((lowerTrimmed.startsWith('code:') || lowerTrimmed.startsWith('line:')) && trimmed.length > 5) {
      const codeQuery = trimmed.slice(trimmed.indexOf(':') + 1).trim();
      if (codeQuery) {
        try {
          const result = await SearchCodeLine(codeQuery);
          if (result.success && result.results) {
            const filtered = await FilterSearchResults(result.results);
            const codeSuggestions = (filtered || result.results).slice(0, 6).map(r => ({
              type: 'code-result',
              icon: 'scid',
              label: r.name || r.scid?.slice(0, 16) + '...',
              value: r.scid || r,
              hint: `Code match`,
              scid: r.scid || r,
              resultData: r
            }));
            suggestions = [...suggestions, ...codeSuggestions];
          }
        } catch (e) { /* continue */ }
      }
    } else if (lowerTrimmed.startsWith('class:')) {
      const classQuery = trimmed.slice(6).trim();
      if (!classQuery) {
        // No class specified - list all available classes
        try {
          const result = await GetAllClasses();
          if (result.success && result.classes) {
            const classSuggestions = result.classes.slice(0, 8).map(c => ({
              type: 'class-result',
              icon: 'scid',
              label: c,
              value: `class:${c}`,
              hint: 'Class'
            }));
            suggestions = [...suggestions, ...classSuggestions];
          }
        } catch (e) { /* continue */ }
      } else {
        // Class specified - get SCIDs in that class
        try {
          const result = await GetSCIDsByClass(classQuery);
          if (result.success && result.scids) {
            const classSuggestions = result.scids.slice(0, 6).map(scid => ({
              type: 'class-result',
              icon: 'scid',
              label: typeof scid === 'string' ? scid.slice(0, 16) + '...' : (scid.name || scid.scid?.slice(0, 16) + '...'),
              value: typeof scid === 'string' ? scid : (scid.scid || scid),
              hint: `Class: ${classQuery}`,
              scid: typeof scid === 'string' ? scid : scid.scid
            }));
            suggestions = [...suggestions, ...classSuggestions];
          }
        } catch (e) { /* continue */ }
      }
    } else if (lowerTrimmed.startsWith('tag:')) {
      const tagQuery = trimmed.slice(4).trim();
      if (tagQuery) {
        try {
          const result = await GetSCIDsByTag(tagQuery);
          if (result.success && result.scids) {
            const tagSuggestions = result.scids.slice(0, 6).map(scid => ({
              type: 'tag-result',
              icon: 'scid',
              label: typeof scid === 'string' ? scid.slice(0, 16) + '...' : (scid.name || scid.scid?.slice(0, 16) + '...'),
              value: typeof scid === 'string' ? scid : (scid.scid || scid),
              hint: `Tag: ${tagQuery}`,
              scid: typeof scid === 'string' ? scid : scid.scid
            }));
            suggestions = [...suggestions, ...tagSuggestions];
          }
        } catch (e) { /* continue */ }
      }
    } else if (trimmed.toLowerCase().startsWith('dero://') || 
        (!trimmed.match(/^[a-fA-F0-9]+$/) && !trimmed.match(/^\d+$/) && !trimmed.toLowerCase().startsWith('dero1'))) {
      // For dURL-like input or partial text, fetch app suggestions from backend
      try {
        // Try weighted full-text search first
        const searchResult = await SearchApps(trimmed);
        if (searchResult.success && searchResult.results && searchResult.results.length > 0) {
          const appSearchSuggestions = searchResult.results.slice(0, 4).map(r => ({
            type: 'app',
            icon: 'app',
            label: r.name || r.durl || r.scid?.slice(0, 16) + '...',
            value: r.durl ? (r.durl.startsWith('dero://') ? r.durl : `dero://${r.durl}`) : r.scid,
            hint: r.description?.slice(0, 30) || 'App',
            scid: r.scid
          }));
          suggestions = [...suggestions, ...appSearchSuggestions];
        }
      } catch (e) { /* continue */ }

      try {
        const result = await GetNameSuggestions(trimmed);
        if (result.success && result.suggestions) {
          const appSuggestions = result.suggestions.map(s => ({
            type: 'app',
            icon: 'app',
            label: s.name,
            value: s.name.startsWith('dero://') ? s.name : `dero://${s.name}`,
            hint: s.avg ? `${s.avg}` : 'App',
            scid: s.scid
          }));
          // Deduplicate by scid
          const existingScids = new Set(suggestions.filter(s => s.scid).map(s => s.scid));
          const newSuggestions = appSuggestions.filter(s => !existingScids.has(s.scid));
          suggestions = [...suggestions, ...newSuggestions];
        }
      } catch (e) {
        // Keep any existing suggestions
      }
    }
    
    // Also include matching recent searches
    if (trimmed) {
      const matchingRecent = recentSearches
        .filter(s => s.query.toLowerCase().includes(trimmed.toLowerCase()))
        .slice(0, 3)
        .map(s => ({
          type: 'recent',
          icon: getTypeIcon(s.type),
          label: s.query.length > 30 ? s.query.slice(0, 15) + '...' + s.query.slice(-12) : s.query,
          value: s.query,
          hint: 'Recent',
          searchType: s.type
        }));
      
      // Add recent matches to the top
      suggestions = [...matchingRecent, ...suggestions].slice(0, 8);
    }
    
    showSuggestions = suggestions.length > 0 && focused;
  }
  
  function getTypeIcon(type) {
    // Icons are rendered in suggestion items via component
    switch (type) {
      case 'block': return 'block';
      case 'tx': return 'tx';
      case 'scid': return 'scid';
      case 'hash': return 'hash';
      case 'durl': return 'durl';
      case 'address': return 'address';
      case 'name': return 'user';
      case 'user': return 'user';
      default: return 'search';
    }
  }
  
  // Type configuration for display
  const typeConfig = {
    block: { 
      label: 'Block', 
      iconType: 'block',
      color: 'c-cyan',
      bg: 'bg-cyan-subtle',
      border: 'border-cyan/40'
    },
    tx: { 
      label: 'Transaction', 
      iconType: 'tx',
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/20',
      border: 'border-cyan-500/40'
    },
    scid: { 
      label: 'Smart Contract', 
      iconType: 'scid',
      color: 'text-purple-400',
      bg: 'bg-purple-500/20',
      border: 'border-purple-500/40'
    },
    hash: { 
      label: 'TX / SCID', 
      iconType: 'hash',
      color: 'text-amber-400',
      bg: 'bg-amber-500/20',
      border: 'border-amber-500/40'
    },
    durl: { 
      label: 'TELA App', 
      iconType: 'durl',
      color: 'text-green-400',
      bg: 'bg-green-500/20',
      border: 'border-green-500/40'
    },
    address: { 
      label: 'Address', 
      iconType: 'address',
      color: 'text-pink-400',
      bg: 'bg-pink-500/20',
      border: 'border-pink-500/40'
    },
    key: { 
      label: 'Key Search', 
      iconType: 'key',
      color: 'text-violet-400',
      bg: 'bg-violet-500/20',
      border: 'border-violet-500/40'
    },
    value: { 
      label: 'Value Search', 
      iconType: 'value',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/20',
      border: 'border-emerald-500/40'
    },
    code: { 
      label: 'Code Search', 
      iconType: 'code',
      color: 'text-orange-400',
      bg: 'bg-orange-500/20',
      border: 'border-orange-500/40'
    },
    class: { 
      label: 'Class Browse', 
      iconType: 'key',
      color: 'text-indigo-400',
      bg: 'bg-indigo-500/20',
      border: 'border-indigo-500/40'
    },
    tag: { 
      label: 'Tag Browse', 
      iconType: 'value',
      color: 'text-teal-400',
      bg: 'bg-teal-500/20',
      border: 'border-teal-500/40'
    },
    unknown: { 
      label: 'Unknown', 
      iconType: 'search',
      color: 'text-label',
      bg: 'bg-gray-500/20',
      border: 'border-gray-500/40'
    },
  };
  
  /**
   * Detect the type of input based on patterns
   */
  function detectInputType(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;
    
    const lowerTrimmed = trimmed.toLowerCase();
    
    // Special search prefixes (key:, value:, code:, class:, tag:)
    if (lowerTrimmed.startsWith('key:')) {
      return 'key';
    }
    if (lowerTrimmed.startsWith('value:')) {
      return 'value';
    }
    if (lowerTrimmed.startsWith('code:') || lowerTrimmed.startsWith('line:')) {
      return 'code';
    }
    if (lowerTrimmed.startsWith('class:')) {
      return 'class';
    }
    if (lowerTrimmed.startsWith('tag:')) {
      return 'tag';
    }
    
    // IMPORTANT: Check 64-char hex FIRST - before block height!
    // This prevents SCIDs like "0000...0001" (all digits) from being misidentified as block heights
    if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
      return 'hash'; // Will be disambiguated during search
    }
    
    // Partial 64-char hex (still typing)
    if (/^[a-fA-F0-9]+$/.test(trimmed) && trimmed.length < 64 && trimmed.length > 8) {
      return 'hash';
    }
    
    // Block height: pure numeric (but not 64 chars - those are hashes)
    // Realistic block heights are under 20 digits
    if (/^\d+$/.test(trimmed) && trimmed.length < 20) {
      return 'block';
    }
    
    // dero://<address> is a payment URI, not a dURL. Mirrors the prefix list
    // used by Browser.svelte navigateTo() and App.svelte ConsumeLaunchURL.
    if (lowerTrimmed.startsWith('dero://')) {
      const body = lowerTrimmed.slice(7);
      if (body.startsWith('dero1') || body.startsWith('deroi1') ||
          body.startsWith('deto1') || body.startsWith('detoi1')) {
        return 'address';
      }
      return 'durl';
    }
    
    // dURL: ends with .tela (TELA app domain pattern)
    // Matches: explorer.tela, my-app.tela, test123.tela, sub.domain.tela
    if (/^[a-z0-9][a-z0-9._-]*\.tela$/i.test(trimmed)) {
      return 'durl';
    }
    
    // DERO Name Service: contains .dero or simple alphanumeric name (3-32 chars)
    // Common NRS patterns: name.dero, just "name" (short alphanumeric)
    if (/\.dero$/i.test(trimmed) || (/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/i.test(trimmed) && !lowerTrimmed.startsWith('dero'))) {
      return 'name';
    }
    
    // Address: starts with dero1
    if (lowerTrimmed.startsWith('dero1')) {
      return 'address';
    }
    
    return 'unknown';
  }
  
  /**
   * Handle search submission
   */
  async function handleSearch() {
    if (!value.trim() || loading) return;
    
    const type = detectedType;
    const query = value.trim();
    
    // For specialized search types, fetch results and include them in the event
    let results = null;
    const lowerQuery = query.toLowerCase();
    
    if (type === 'key' && lowerQuery.startsWith('key:')) {
      const keyQuery = query.slice(4).trim();
      if (keyQuery) {
        try {
          loading = true;
          const res = await SearchByKey(keyQuery);
          if (res.success) results = res.results;
        } catch (e) { /* continue */ }
        finally { loading = false; }
      }
    } else if (type === 'value' && lowerQuery.startsWith('value:')) {
      const valQuery = query.slice(6).trim();
      if (valQuery) {
        try {
          loading = true;
          const res = await SearchByValue(valQuery);
          if (res.success) results = res.results;
        } catch (e) { /* continue */ }
        finally { loading = false; }
      }
    } else if (type === 'code' && (lowerQuery.startsWith('code:') || lowerQuery.startsWith('line:'))) {
      const codeQuery = query.slice(query.indexOf(':') + 1).trim();
      if (codeQuery) {
        try {
          loading = true;
          const res = await SearchCodeLine(codeQuery);
          if (res.success) results = res.results;
        } catch (e) { /* continue */ }
        finally { loading = false; }
      }
    } else if (type === 'class' && lowerQuery.startsWith('class:')) {
      const classQuery = query.slice(6).trim();
      try {
        loading = true;
        if (!classQuery) {
          const res = await GetAllClasses();
          if (res.success) results = res.classes;
        } else {
          const res = await GetSCIDsByClass(classQuery);
          if (res.success) results = res.scids;
        }
      } catch (e) { /* continue */ }
      finally { loading = false; }
    } else if (type === 'tag' && lowerQuery.startsWith('tag:')) {
      const tagQuery = query.slice(4).trim();
      if (tagQuery) {
        try {
          loading = true;
          const res = await GetSCIDsByTag(tagQuery);
          if (res.success) results = res.scids;
        } catch (e) { /* continue */ }
        finally { loading = false; }
      }
    }
    
    // Apply content filter if we have results
    if (results && results.length > 0) {
      try {
        const filtered = await FilterSearchResults(results);
        if (filtered) results = filtered;
      } catch (e) { /* use unfiltered */ }
    }
    
    dispatch('search', { query, type, results });
  }
  
  /**
   * Handle key press
   */
  function handleKeydown(event) {
    if (showSuggestions && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedIndex = (selectedIndex + 1) % suggestions.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex = selectedIndex <= 0 ? suggestions.length - 1 : selectedIndex - 1;
        return;
      }
      if (event.key === 'Tab' && suggestions.length > 0) {
        event.preventDefault();
        const idx = selectedIndex >= 0 ? selectedIndex : 0;
        selectSuggestion(suggestions[idx]);
        return;
      }
      if (event.key === 'Enter' && selectedIndex >= 0) {
        event.preventDefault();
        selectSuggestion(suggestions[selectedIndex]);
        return;
      }
    }
    
    if (event.key === 'Enter') {
      event.preventDefault();
      showSuggestions = false;
      handleSearch();
    }
    if (event.key === 'Escape') {
      if (showSuggestions) {
        showSuggestions = false;
        selectedIndex = -1;
      } else {
        value = '';
        inputElement?.blur();
      }
    }
  }
  
  /**
   * Handle input change
   */
  function handleInput(event) {
    value = event.target.value;
    selectedIndex = -1;
    dispatch('input', { value, type: detectedType });
    
    // Debounce suggestion fetching
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      fetchSuggestions(value);
    }, 150);
  }
  
  /**
   * Select a suggestion
   */
  function selectSuggestion(suggestion) {
    value = suggestion.value;
    showSuggestions = false;
    selectedIndex = -1;
    
    // If it's a direct app/dURL or search result, trigger search immediately
    if (suggestion.type === 'app' || suggestion.searchType === 'durl' || suggestion.searchType === 'scid' ||
        suggestion.type === 'key-result' || suggestion.type === 'value-result' || suggestion.type === 'code-result' ||
        suggestion.type === 'class-result' || suggestion.type === 'tag-result') {
      handleSearch();
    } else {
      // Focus input for further editing or Enter to search
      inputElement?.focus();
    }
  }
  
  /**
   * Handle focus
   */
  function handleFocus() {
    focused = true;
    
    // If this component was set to autofocus, skip showing the dropdown on the VERY FIRST focus event
    if (autofocus && !initialFocusSkipped) {
      initialFocusSkipped = true;
      return;
    }
    
    // Skip auto-dropdown on initial mount (for programmatic focus)
    if (Date.now() - mountedAt < 500) return;
    
    // Show recent searches when focused and empty
    if (!value.trim()) {
      fetchSuggestions('');
    }
  }
  
  /**
   * Handle click on input (to show recent searches if already focused)
   */
  function handleClick() {
    if (focused && !showSuggestions) {
      fetchSuggestions(value);
    }
  }
  
  /**
   * Handle blur
   */
  function handleBlur() {
    // Delay to allow click on suggestion
    setTimeout(() => {
      focused = false;
      showSuggestions = false;
      selectedIndex = -1;
    }, 200);
  }
  
  /**
   * Clear the search
   */
  function clearSearch() {
    value = '';
    dispatch('clear');
    inputElement?.focus();
  }
  
  /**
   * Focus the input
   */
  export function focus() {
    inputElement?.focus();
  }
  
  $: currentTypeConfig = detectedType ? typeConfig[detectedType] : null;
</script>

<div class="omni-search" class:compact class:focused>
  <div class="search-container">
    <!-- Search Icon (hidden in compact/toolbar mode) -->
    {#if !compact}
    <div class="search-icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
        <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" />
      </svg>
    </div>
    {/if}
    
    <!-- Input Field -->
    <input
      bind:this={inputElement}
      type="text"
      {placeholder}
      value={value}
      on:input={handleInput}
      on:keydown={handleKeydown}
      on:focus={handleFocus}
      on:blur={handleBlur}
      on:click={handleClick}
      disabled={loading}
      class="search-input"
      class:has-type={currentTypeConfig}
      {autofocus}
      autocomplete="off"
    />
    
    <!-- Type Indicator Badge -->
    {#if currentTypeConfig && value.trim()}
      <div class="type-badge {currentTypeConfig.bg} {currentTypeConfig.border}">
        <span class="type-icon">
          {#if currentTypeConfig.iconType === 'block'}<Blocks size={12} strokeWidth={1.5} />
          {:else if currentTypeConfig.iconType === 'tx'}<Zap size={12} strokeWidth={1.5} />
          {:else if currentTypeConfig.iconType === 'scid' || currentTypeConfig.iconType === 'hash'}<FileText size={12} strokeWidth={1.5} />
          {:else if currentTypeConfig.iconType === 'durl'}<Globe size={12} strokeWidth={1.5} />
          {:else if currentTypeConfig.iconType === 'address'}<User size={12} strokeWidth={1.5} />
          {:else if currentTypeConfig.iconType === 'key'}<Key size={12} strokeWidth={1.5} />
          {:else if currentTypeConfig.iconType === 'value'}<Database size={12} strokeWidth={1.5} />
          {:else if currentTypeConfig.iconType === 'code'}<Code size={12} strokeWidth={1.5} />
          {:else}<Blocks size={12} strokeWidth={1.5} />{/if}
        </span>
        <span class="type-label {currentTypeConfig.color}">{currentTypeConfig.label}</span>
      </div>
    {/if}
    
    <!-- Clear Button -->
    {#if value && !loading}
      <button class="clear-btn" on:click={clearSearch} title="Clear search">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    {/if}
    
    <!-- Loading Spinner -->
    {#if loading}
      <div class="loading-spinner">
        <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    {/if}
    
    <!-- Search Button (hidden in compact/toolbar mode - Enter key suffices) -->
    {#if !compact}
    <button 
      class="search-btn"
      on:click={handleSearch}
      disabled={!value.trim() || loading}
      title="Search (Enter)"
    >
      {#if loading}
        Searching...
      {:else}
        Search
      {/if}
    </button>
    {/if}
  </div>
  
  <!-- Suggestions Dropdown -->
  {#if showSuggestions && suggestions.length > 0}
    <div class="suggestions-dropdown">
      {#each suggestions as suggestion, i}
        <button
          class="suggestion-item"
          class:selected={i === selectedIndex}
          on:click={() => selectSuggestion(suggestion)}
          on:mouseenter={() => selectedIndex = i}
        >
          <span class="suggestion-icon">
            {#if suggestion.icon === 'block' || suggestion.icon === 'package'}<Package size={14} strokeWidth={1.5} />
            {:else if suggestion.icon === 'tx'}<Zap size={14} strokeWidth={1.5} />
            {:else if suggestion.icon === 'scid' || suggestion.icon === 'hash'}<FileText size={14} strokeWidth={1.5} />
            {:else if suggestion.icon === 'durl' || suggestion.icon === 'app'}<Globe size={14} strokeWidth={1.5} />
            {:else if suggestion.icon === 'address'}<User size={14} strokeWidth={1.5} />
            {:else}<Search size={14} strokeWidth={1.5} />{/if}
          </span>
          <span class="suggestion-label">{suggestion.label}</span>
          <span class="suggestion-hint">{suggestion.hint}</span>
        </button>
      {/each}
      <div class="suggestions-footer">
        <span>↑↓ Navigate</span>
        <span>Enter Select</span>
        <span>Tab Autocomplete</span>
      </div>
    </div>
  {/if}
  
</div>

<style>
  .omni-search {
    width: 100%;
    position: relative;
  }
  
  .search-container {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-default, rgba(255, 255, 255, 0.09));
    border-radius: var(--r-xl, 16px);
    padding: var(--s-3, 12px) var(--s-4, 16px);
    transition: all 0.2s ease;
  }
  
  .omni-search.focused .search-container {
    border-color: var(--cyan-500, #06b6d4);
    box-shadow: var(--glow-cyan-sm, 0 0 15px rgba(34, 211, 238, 0.15));
  }
  
  .omni-search.compact .search-container {
    padding: 0;
    gap: 6px;
    background: transparent;
    border: none;
    border-radius: 0;
  }

  .omni-search.compact.focused .search-container {
    border: none;
    box-shadow: none;
  }
  
  .search-icon {
    color: var(--text-4, #505068);
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }
  
  .search-icon svg {
    width: 18px;
    height: 18px;
  }
  
  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-1, #f8f8fc);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 13px;
    min-width: 200px;
    width: 100%;
  }
  
  .search-input::placeholder {
    color: var(--text-4, #505068);
    white-space: nowrap;
    overflow: visible;
  }
  
  .search-input:disabled {
    opacity: 0.6;
  }
  
  .omni-search.compact .search-input {
    font-size: 0.85rem;
    min-width: 0;
  }
  
  .type-badge {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid;
    border-radius: 6px;
    flex-shrink: 0;
    animation: badge-appear 0.15s ease;
  }
  
  @keyframes badge-appear {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  
  .type-icon {
    font-size: 0.8rem;
  }
  
  .type-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  
  .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  
  .clear-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.8);
  }
  
  .loading-spinner {
    flex-shrink: 0;
    color: #52c8db;
  }
  
  .loading-spinner svg {
    width: 1.25rem;
    height: 1.25rem;
  }
  
  .search-btn {
    padding: var(--s-2, 8px) var(--s-4, 16px);
    background: var(--cyan-500, #06b6d4);
    border: none;
    border-radius: var(--r-md, 8px);
    color: var(--void-pure, #000);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--dur-fast, 150ms);
    flex-shrink: 0;
  }
  
  .search-btn:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
    box-shadow: var(--glow-cyan-sm, 0 0 15px rgba(34, 211, 238, 0.3));
  }
  
  .search-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  
  .omni-search.compact .search-btn {
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    border-radius: 6px;
  }
  
  
  /* Animation for spinner */
  .animate-spin {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  /* Suggestions Dropdown */
  .suggestions-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    background: rgba(20, 20, 30, 0.98);
    border: 1px solid rgba(82, 200, 219, 0.3);
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    z-index: 1000;
    backdrop-filter: blur(20px);
    animation: dropdown-appear 0.15s ease;
  }
  
  @keyframes dropdown-appear {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .suggestion-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    border-left: 3px solid transparent;
    cursor: pointer;
    transition: all 0.1s ease;
    text-align: left;
  }
  
  .suggestion-item:hover,
  .suggestion-item.selected {
    background: rgba(82, 200, 219, 0.1);
    border-left-color: #52c8db;
  }
  
  .suggestion-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }
  
  .suggestion-label {
    flex: 1;
    font-size: 0.9rem;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: monospace;
  }
  
  .suggestion-hint {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
    padding: 0.2rem 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }
  
  .suggestions-footer {
    display: flex;
    justify-content: center;
    gap: 1.5rem;
    padding: 0.5rem 1rem;
    background: rgba(0, 0, 0, 0.3);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.35);
  }
</style>

