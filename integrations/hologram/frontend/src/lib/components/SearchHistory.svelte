<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { appState } from '../stores/appState.js';
  import { recentSearchesKey, pinnedSearchesKey, migrateLegacyExplorerSearchStorage } from '../recentSearchStorage.js';
  import { Search, Inbox, Pin, Clock, X } from 'lucide-svelte';
  
  const dispatch = createEventDispatcher();
  
  export let isOpen = false;
  
  let searches = [];
  let pinnedSearches = [];
  let filter = ''; // Filter by query
  
  const MAX_HISTORY = 50;
  
  function historyNetwork() {
    return get(appState)?.network || 'mainnet';
  }
  
  onMount(() => {
    loadSearches();
  });
  
  function loadSearches() {
    migrateLegacyExplorerSearchStorage();
    try {
      const stored = localStorage.getItem(recentSearchesKey(historyNetwork()));
      searches = stored ? JSON.parse(stored).slice(0, MAX_HISTORY) : [];
      
      const pinned = localStorage.getItem(pinnedSearchesKey(historyNetwork()));
      pinnedSearches = pinned ? JSON.parse(pinned) : [];
    } catch (e) {
      searches = [];
      pinnedSearches = [];
    }
  }
  
  function saveSearches() {
    try {
      localStorage.setItem(recentSearchesKey(historyNetwork()), JSON.stringify(searches));
      localStorage.setItem(pinnedSearchesKey(historyNetwork()), JSON.stringify(pinnedSearches));
    } catch (e) {
      // Ignore storage errors
    }
  }
  
  $: $appState.network, loadSearches();
  
  function isPinned(query) {
    return pinnedSearches.includes(query);
  }
  
  function togglePin(search) {
    if (isPinned(search.query)) {
      pinnedSearches = pinnedSearches.filter(q => q !== search.query);
    } else {
      pinnedSearches = [search.query, ...pinnedSearches];
    }
    saveSearches();
  }
  
  function removeSearch(search) {
    searches = searches.filter(s => s.query !== search.query);
    pinnedSearches = pinnedSearches.filter(q => q !== search.query);
    saveSearches();
  }
  
  function clearAll() {
    searches = [];
    // Keep pinned items
    saveSearches();
  }
  
  function clearUnpinned() {
    searches = searches.filter(s => isPinned(s.query));
    saveSearches();
  }
  
  function selectSearch(search) {
    dispatch('select', search);
    close();
  }
  
  function close() {
    isOpen = false;
    dispatch('close');
  }
  
  // Type icons - using approved Unicode symbols (NO EMOJIS per Design System v7.0)
  function getTypeIcon(type) {
    switch (type) {
      case 'block': return 'B';
      case 'tx': return '◎';      // Transfer/transaction
      case 'scid': return '⬢';    // Smart contract (hexagon)
      case 'hash': return '#';
      case 'durl': return '@';
      case 'address': return 'A';
      default: return '?';
    }
  }
  
  function formatTimestamp(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  }
  
  function truncateQuery(query, maxLen = 40) {
    if (query.length <= maxLen) return query;
    return query.slice(0, maxLen / 2 - 2) + '...' + query.slice(-(maxLen / 2 - 2));
  }
  
  // Filtered and sorted searches
  $: filteredSearches = searches
    .filter(s => !filter || s.query.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      // Pinned items first
      const aPinned = isPinned(a.query);
      const bPinned = isPinned(b.query);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      // Then by timestamp
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
  
  $: pinnedCount = searches.filter(s => isPinned(s.query)).length;
  $: unpinnedCount = searches.length - pinnedCount;
</script>

{#if isOpen}
  <div class="modal-overlay" on:click={close}>
    <div class="modal-content modal-content-wide search-history-modal" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-icon">
            <Search size={16} />
          </div>
          <div>
            <h2 class="modal-title">Search History</h2>
            <p class="modal-subtitle">Recent and pinned searches</p>
          </div>
        </div>
        <button class="modal-close" on:click={close} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      
      <div class="modal-toolbar">
        <div class="filter-input">
          <span class="filter-icon"><Search size={12} /></span>
          <input 
            type="text" 
            placeholder="Filter searches..."
            bind:value={filter}
          />
        </div>
        <div class="toolbar-actions">
          {#if unpinnedCount > 0}
            <button class="action-btn" on:click={clearUnpinned} title="Clear unpinned">
              Clear Unpinned
            </button>
          {/if}
          {#if searches.length > 0}
            <button class="action-btn danger" on:click={clearAll} title="Clear all history">
              Clear All
            </button>
          {/if}
        </div>
      </div>
      
      <div class="modal-body">
        {#if filteredSearches.length === 0}
          <div class="empty-state">
            <span class="empty-icon"><Inbox size={24} /></span>
            <p>{filter ? 'No matching searches found' : 'No search history yet'}</p>
            <p class="empty-hint">Your searches will appear here</p>
          </div>
        {:else}
          <div class="search-list">
            {#each filteredSearches as search}
              <div class="search-item" class:pinned={isPinned(search.query)}>
                <button class="pin-btn" on:click={() => togglePin(search)} title={isPinned(search.query) ? 'Unpin' : 'Pin'}>
                  {#if isPinned(search.query)}
                    <Pin size={14} fill="currentColor" />
                  {:else}
                    <Clock size={14} />
                  {/if}
                </button>
                
                <button class="search-content" on:click={() => selectSearch(search)}>
                  <span class="search-icon">{getTypeIcon(search.type)}</span>
                  <span class="search-query">{truncateQuery(search.query)}</span>
                  <span class="search-time">{formatTimestamp(search.timestamp)}</span>
                </button>
                
                <button class="remove-btn" on:click={() => removeSearch(search)} title="Remove">
                  ×
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      
      <div class="modal-footer">
        <span class="stats">
          {searches.length} searches • {pinnedCount} pinned
        </span>
        <button class="modal-btn modal-btn-primary" on:click={close}>Done</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .search-history-modal {
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    animation: modal-appear 0.2s ease;
  }
  
  @keyframes modal-appear {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(-10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  
  .modal-toolbar {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-4) var(--s-6);
    background: var(--void-deep);
    border-bottom: 1px solid var(--border-subtle);
  }
  
  .filter-input {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: var(--void-base);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
  }
  
  .filter-icon {
    color: var(--text-4);
  }
  
  .filter-input input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-1);
    font-size: 13px;
    font-family: var(--font-mono);
  }
  
  .filter-input input::placeholder {
    color: var(--text-4);
  }
  
  .toolbar-actions {
    display: flex;
    gap: var(--s-2);
  }
  
  .action-btn {
    padding: var(--s-2) var(--s-3);
    background: var(--void-up);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 12px;
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .action-btn:hover {
    background: var(--void-hover);
    color: var(--text-1);
  }
  
  .action-btn.danger:hover {
    background: rgba(248, 113, 113, 0.15);
    border-color: rgba(248, 113, 113, 0.3);
    color: var(--status-err);
  }
  
  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--s-4);
  }
  
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--s-12) var(--s-4);
    text-align: center;
  }
  
  .empty-icon {
    margin-bottom: var(--s-4);
    opacity: 0.6;
    color: var(--text-3);
  }
  
  .empty-state p {
    margin: 0;
    color: var(--text-3);
  }
  
  .empty-hint {
    font-size: 12px;
    margin-top: var(--s-2);
    color: var(--text-4);
  }
  
  .search-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  
  .search-item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2);
    background: var(--void-deep);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    transition: all 150ms ease;
  }
  
  .search-item:hover {
    background: var(--void-up);
    border-color: var(--border-default);
  }
  
  .search-item.pinned {
    background: rgba(251, 191, 36, 0.08);
    border-color: rgba(251, 191, 36, 0.24);
  }
  
  .pin-btn, .remove-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: all 150ms ease;
    flex-shrink: 0;
  }
  
  .pin-btn {
    color: var(--text-4);
    opacity: 0.8;
  }
  
  .pin-btn:hover {
    background: rgba(251, 191, 36, 0.1);
    color: var(--status-warn);
    opacity: 1;
  }
  
  .search-item.pinned .pin-btn {
    opacity: 1;
  }
  
  .remove-btn {
    color: var(--text-4);
  }
  
  .remove-btn:hover {
    background: rgba(248, 113, 113, 0.15);
    color: var(--status-err);
  }
  
  .search-content {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background 150ms ease;
    text-align: left;
    min-width: 0;
  }
  
  .search-content:hover {
    background: rgba(34, 211, 238, 0.1);
  }
  
  .search-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }
  
  .search-query {
    flex: 1;
    font-size: 13px;
    color: var(--text-1);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .search-time {
    font-size: 11px;
    color: var(--text-4);
    flex-shrink: 0;
  }
  
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-4) var(--s-6);
    border-top: 1px solid var(--border-subtle);
    background: var(--void-deep);
  }
  
  .stats {
    font-size: 12px;
    color: var(--text-3);
  }
  
  /* Scrollbar */
  .modal-body::-webkit-scrollbar {
    width: var(--s-2);
  }
  
  .modal-body::-webkit-scrollbar-track {
    background: var(--void-base);
    border-radius: var(--r-xs);
  }
  
  .modal-body::-webkit-scrollbar-thumb {
    background: rgba(34, 211, 238, 0.3);
    border-radius: var(--r-xs);
  }
  
  .modal-body::-webkit-scrollbar-thumb:hover {
    background: rgba(34, 211, 238, 0.5);
  }
</style>

