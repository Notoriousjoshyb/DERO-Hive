<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { GetMODsList } from '../../../wailsjs/go/main/App.js';
  import { Puzzle, X } from 'lucide-svelte';
  
  export let show = false;
  export let selectedVsMod = '';
  export let selectedTxMods = [];
  
  const dispatch = createEventDispatcher();
  
  let allMods = [];
  let loading = true;
  let error = null;
  
  // Local state for modal selections
  let localVsMod = '';
  let localTxMods = [];
  
  onMount(async () => {
    await loadMods();
  });
  
  $: if (show) {
    // Sync with external state when modal opens
    localVsMod = selectedVsMod;
    localTxMods = [...selectedTxMods];
  }
  
  async function loadMods() {
    loading = true;
    error = null;
    try {
      const result = await GetMODsList();
      if (result.success && result.mods) {
        allMods = result.mods;
      } else {
        error = result.error || 'Failed to load MODs';
      }
    } catch (e) {
      error = e.message || 'Failed to load MODs';
    } finally {
      loading = false;
    }
  }
  
  function getVsMods() {
    return allMods.filter(m => m.tag?.startsWith('vs'));
  }
  
  function getTxMods() {
    return allMods.filter(m => m.tag?.startsWith('tx'));
  }
  
  function selectVsMod(tag) {
    localVsMod = localVsMod === tag ? '' : tag;
  }
  
  function toggleTxMod(tag) {
    if (localTxMods.includes(tag)) {
      localTxMods = localTxMods.filter(t => t !== tag);
    } else {
      localTxMods = [...localTxMods, tag];
    }
  }
  
  function getSelectedTags() {
    const tags = [];
    if (localVsMod) tags.push(localVsMod);
    tags.push(...localTxMods);
    return tags.join(',');
  }
  
  function confirm() {
    dispatch('confirm', {
      vsMod: localVsMod,
      txMods: localTxMods,
      tags: getSelectedTags()
    });
    close();
  }
  
  function close() {
    dispatch('close');
  }
  
  function clearAll() {
    localVsMod = '';
    localTxMods = [];
  }
</script>

{#if show}
  <div class="modal-overlay" on:click={close}>
    <div class="modal-content modal-content-wide mods-modal-content" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-icon">
            <Puzzle size={18} />
          </div>
          <div>
            <h2 class="modal-title">TELA-MODs</h2>
            <p class="modal-subtitle">Add smart contract functionality to your INDEX</p>
          </div>
        </div>
        <button class="modal-close" on:click={close} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      
      <div class="modal-body mods-modal-body">
        {#if loading}
          <div class="loading-state">
            <div class="spinner"></div>
            <span>Loading MODs...</span>
          </div>
        {:else if error}
          <div class="error-state">
            <span class="error-icon">!</span>
            <span>{error}</span>
            <button class="retry-btn" on:click={loadMods}>Retry</button>
          </div>
        {:else}
          <!-- Variable Store Section -->
          <div class="mod-section">
            <div class="section-header">
              <span class="section-icon">◈</span>
              <div class="section-info">
                <h3 class="section-title">Variable Store</h3>
                <p class="section-desc">On-chain key-value storage for your application</p>
              </div>
              <span class="section-hint">select one</span>
            </div>
            
            <div class="mod-grid">
              <button 
                class="mod-card {localVsMod === '' ? 'selected' : ''}"
                on:click={() => localVsMod = ''}
              >
                <span class="mod-tag">—</span>
                <span class="mod-name">None</span>
                <span class="mod-desc">No variable storage</span>
              </button>
              
              {#each getVsMods() as mod}
                <button 
                  class="mod-card {localVsMod === mod.tag ? 'selected' : ''}"
                  on:click={() => selectVsMod(mod.tag)}
                >
                  <span class="mod-tag">{mod.tag}</span>
                  <span class="mod-name">{mod.name?.replace('Variable store ', '') || mod.tag}</span>
                  <span class="mod-desc">{mod.description || `Class: ${mod.class}`}</span>
                  {#if localVsMod === mod.tag}
                    <span class="mod-check">✓</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
          
          <!-- Transfer Section -->
          <div class="mod-section">
            <div class="section-header">
              <span class="section-icon">◆</span>
              <div class="section-info">
                <h3 class="section-title">Transfers</h3>
                <p class="section-desc">Enable token deposits and transfers</p>
              </div>
              <span class="section-hint">select multiple</span>
            </div>
            
            <div class="mod-grid">
              {#each getTxMods() as mod}
                <button 
                  class="mod-card {localTxMods.includes(mod.tag) ? 'selected' : ''}"
                  on:click={() => toggleTxMod(mod.tag)}
                >
                  <span class="mod-tag">{mod.tag}</span>
                  <span class="mod-name">{mod.name || mod.tag}</span>
                  <span class="mod-desc">{mod.description || `Class: ${mod.class}`}</span>
                  {#if localTxMods.includes(mod.tag)}
                    <span class="mod-check">✓</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
          
          <!-- Selected Summary -->
          {#if getSelectedTags()}
            <div class="selection-summary">
              <span class="summary-label">Selected MODs:</span>
              <code class="summary-tags">{getSelectedTags()}</code>
              <button class="clear-btn" on:click={clearAll}>Clear All</button>
            </div>
          {/if}
          
          <!-- Info Note -->
          <div class="info-note">
            <span class="info-icon">ℹ</span>
            <span>MODs require Ring 2 (updateable) for the INDEX. They add smart contract functionality and may increase deployment cost.</span>
          </div>
        {/if}
      </div>
      
      <div class="modal-footer">
        <button class="modal-btn modal-btn-secondary" on:click={close}>Cancel</button>
        <button class="modal-btn modal-btn-primary" on:click={confirm} disabled={loading}>
          {#if getSelectedTags()}
            Apply {localVsMod ? 1 : 0}{localTxMods.length > 0 ? '+' + localTxMods.length : ''} MOD{(localVsMod ? 1 : 0) + localTxMods.length !== 1 ? 's' : ''}
          {:else}
            Apply (No MODs)
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .mods-modal-content {
    width: 100%;
    max-width: 640px;
    max-height: 85vh;
  }

  .mods-modal-body {
    display: flex;
    flex-direction: column;
    gap: var(--s-5, 20px);
  }
  
  .loading-state,
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-3, 12px);
    padding: var(--s-8, 32px);
    color: var(--text-4, #505068);
  }
  
  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--violet-500, #8b5cf6);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .error-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(248, 113, 113, 0.2);
    border-radius: 50%;
    color: var(--status-err, #f87171);
    font-weight: 700;
  }
  
  .retry-btn {
    padding: var(--s-2, 8px) var(--s-4, 16px);
    background: var(--void-up, #181824);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: var(--r-md, 8px);
    color: var(--text-3, #707088);
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .retry-btn:hover {
    background: var(--void-surface, #1e1e2a);
    color: var(--cyan-400, #22d3ee);
    border-color: var(--cyan-500, #06b6d4);
  }
  
  /* Section Styles */
  .mod-section {
    background: var(--void-deep, #08080e);
    border-radius: var(--r-xl, 16px);
    padding: var(--s-4, 16px);
  }
  
  .section-header {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3, 12px);
    margin-bottom: var(--s-4, 16px);
  }
  
  .section-icon {
    font-size: 18px;
    color: var(--cyan-400, #22d3ee);
    line-height: 1;
    margin-top: 2px;
  }
  
  .section-info {
    flex: 1;
  }
  
  .section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1, #f8f8fc);
    margin: 0 0 var(--s-1, 4px) 0;
  }
  
  .section-desc {
    font-size: 12px;
    color: var(--text-4, #505068);
    margin: 0;
  }
  
  .section-hint {
    font-size: 11px;
    color: var(--text-5, #404058);
    background: var(--void-up, #181824);
    padding: 2px 8px;
    border-radius: var(--r-sm, 5px);
    white-space: nowrap;
  }
  
  /* MOD Grid */
  .mod-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--s-2, 8px);
  }
  
  .mod-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--s-1, 4px);
    padding: var(--s-3, 12px);
    background: var(--void-up, #181824);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-lg, 12px);
    text-align: left;
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .mod-card:hover {
    border-color: var(--border-subtle, rgba(255, 255, 255, 0.06));
    background: var(--void-surface, #1e1e2a);
  }
  
  .mod-card.selected {
    border-color: var(--violet-500, #8b5cf6);
    background: rgba(139, 92, 246, 0.12);
  }
  
  .mod-tag {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 10px;
    color: var(--text-3, #707088);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    width: fit-content;
  }
  
  .mod-card.selected .mod-tag {
    background: rgba(139, 92, 246, 0.3);
    color: var(--violet-300, #c4b5fd);
  }
  
  .mod-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2, #a8a8b8);
  }
  
  .mod-card.selected .mod-name {
    color: var(--text-1, #f8f8fc);
  }
  
  .mod-desc {
    font-size: 11px;
    color: var(--text-5, #404058);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  
  .mod-check {
    position: absolute;
    top: var(--s-2, 8px);
    right: var(--s-2, 8px);
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--violet-500, #8b5cf6);
    border-radius: 50%;
    color: white;
    font-size: 11px;
    font-weight: 600;
  }
  
  /* Selection Summary */
  .selection-summary {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
    padding: var(--s-3, 12px) var(--s-4, 16px);
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid rgba(139, 92, 246, 0.25);
    border-radius: var(--r-lg, 12px);
  }
  
  .summary-label {
    font-size: 12px;
    color: var(--text-3, #707088);
  }
  
  .summary-tags {
    flex: 1;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    color: var(--violet-400, #a78bfa);
  }
  
  .clear-btn {
    padding: var(--s-1, 4px) var(--s-2, 8px);
    background: transparent;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-radius: var(--r-sm, 5px);
    color: var(--text-4, #505068);
    font-size: 11px;
    cursor: pointer;
    transition: all 150ms ease;
  }
  
  .clear-btn:hover {
    background: var(--void-up, #181824);
    color: var(--text-2, #a8a8b8);
  }
  
  /* Info Note */
  .info-note {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2, 8px);
    padding: var(--s-3, 12px);
    background: rgba(6, 182, 212, 0.08);
    border-radius: var(--r-md, 8px);
    font-size: 12px;
    color: var(--text-4, #505068);
    line-height: 1.5;
  }
  
  .info-icon {
    color: var(--cyan-400, #22d3ee);
    flex-shrink: 0;
  }
  
  .modal-footer .modal-btn {
    flex: 1;
  }
</style>

