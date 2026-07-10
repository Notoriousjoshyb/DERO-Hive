<script>
  import { createEventDispatcher } from 'svelte';
  import { DiffFiles, DiffSCIDs } from '../../../wailsjs/go/main/App.js';
  import { SelectFile } from '../../../wailsjs/go/main/App.js';
  import { toast } from '../stores/appState.js';
  
  const dispatch = createEventDispatcher();
  
  export let visible = false;
  
  let mode = 'files';  // 'files' or 'scids'
  let file1 = '';
  let file2 = '';
  let scid1 = '';
  let scid2 = '';
  let loading = false;
  let diffResult = null;
  let viewMode = 'unified';  // 'unified' or 'side-by-side'
  
  async function selectFile(num) {
    try {
      const path = await SelectFile();
      if (path) {
        if (num === 1) file1 = path;
        else file2 = path;
      }
    } catch (e) {
      console.error('File selection error:', e);
    }
  }
  
  async function performDiff() {
    loading = true;
    diffResult = null;
    
    try {
      let result;
      if (mode === 'files') {
        if (!file1 || !file2) {
          toast.warning('Please select both files');
          return;
        }
        result = await DiffFiles(file1, file2);
      } else {
        if (!scid1 || !scid2) {
          toast.warning('Please enter both SCIDs');
          return;
        }
        if (scid1.length !== 64 || scid2.length !== 64) {
          toast.warning('SCIDs must be 64 characters');
          return;
        }
        result = await DiffSCIDs(scid1, scid2);
      }
      
      if (result.success) {
        diffResult = result;
        if (result.identical) {
          toast.success('Files are identical!');
        }
      } else {
        toast.error(result.error || 'Diff failed');
      }
    } catch (e) {
      toast.error(e.message || 'Diff failed');
    } finally {
      loading = false;
    }
  }
  
  function close() {
    visible = false;
    diffResult = null;
    dispatch('close');
  }
  
  function clearInputs() {
    file1 = '';
    file2 = '';
    scid1 = '';
    scid2 = '';
    diffResult = null;
  }
  
  function getDiffTypeColor(type) {
    switch (type) {
      case 'add': return 'diff-add';
      case 'remove': return 'diff-remove';
      case 'change': return 'diff-change';
      default: return '';
    }
  }
  
  function getDiffTypeIcon(type) {
    switch (type) {
      case 'add': return '+';
      case 'remove': return '-';
      case 'change': return '~';
      default: return ' ';
    }
  }
</script>

{#if visible}
  <div class="diff-backdrop" on:click={close}>
    <div class="diff-modal" on:click|stopPropagation>
      <!-- Header -->
      <div class="diff-header">
        <div class="diff-header-left">
          <span class="diff-header-icon">◈</span>
          <h2 class="diff-title">Code Diff Viewer</h2>
        </div>
        <button on:click={close} class="diff-close-btn">✕</button>
      </div>
      
      <!-- Mode Selector -->
      <div class="diff-mode-bar">
        <div class="mode-tabs">
          <div class="mode-tab-group">
            <button
              on:click={() => { mode = 'files'; clearInputs(); }}
              class="mode-tab {mode === 'files' ? 'active' : ''}"
            >
              <span class="mode-icon">◇</span> Local Files
            </button>
            <button
              on:click={() => { mode = 'scids'; clearInputs(); }}
              class="mode-tab {mode === 'scids' ? 'active' : ''}"
            >
              <span class="mode-icon">□</span> Smart Contracts
            </button>
          </div>
          
          {#if diffResult}
            <div class="view-tab-group">
              <button
                on:click={() => viewMode = 'unified'}
                class="view-tab {viewMode === 'unified' ? 'active' : ''}"
              >
                Unified
              </button>
              <button
                on:click={() => viewMode = 'side-by-side'}
                class="view-tab {viewMode === 'side-by-side' ? 'active' : ''}"
              >
                Side-by-Side
              </button>
            </div>
          {/if}
        </div>
      </div>
      
      <!-- Input Form -->
      <div class="diff-form">
        {#if mode === 'files'}
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">File 1 (Original)</label>
              <div class="input-row">
                <input
                  type="text"
                  bind:value={file1}
                  placeholder="Select or enter file path..."
                  class="input-field"
                />
                <button on:click={() => selectFile(1)} class="btn-secondary">
                  Browse
                </button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">File 2 (Modified)</label>
              <div class="input-row">
                <input
                  type="text"
                  bind:value={file2}
                  placeholder="Select or enter file path..."
                  class="input-field"
                />
                <button on:click={() => selectFile(2)} class="btn-secondary">
                  Browse
                </button>
              </div>
            </div>
          </div>
        {:else}
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">SCID 1 (Original)</label>
              <input
                type="text"
                bind:value={scid1}
                placeholder="Enter first SCID..."
                class="input-field mono"
              />
            </div>
            <div class="form-group">
              <label class="form-label">SCID 2 (Modified)</label>
              <input
                type="text"
                bind:value={scid2}
                placeholder="Enter second SCID..."
                class="input-field mono"
              />
            </div>
          </div>
        {/if}
        
        <div class="form-actions">
          <button
            on:click={performDiff}
            disabled={loading}
            class="btn-primary"
          >
            {loading ? 'Comparing...' : 'Compare'}
          </button>
          <button on:click={clearInputs} class="btn-secondary">
            Clear
          </button>
        </div>
      </div>
      
      <!-- Diff Results -->
      <div class="diff-results">
        {#if diffResult}
          {#if diffResult.identical}
            <div class="diff-empty-state">
              <span class="empty-icon success">✓</span>
              <h3 class="empty-title success">Files are Identical</h3>
              <p class="empty-desc">No differences found between the two {mode === 'files' ? 'files' : 'smart contracts'}.</p>
            </div>
          {:else}
            <!-- Summary -->
            <div class="diff-summary">
              <div class="summary-item">
                <span class="summary-dot add"></span>
                <span class="summary-label">Added: {diffResult.diffs.filter(d => d.Type === 'add').length}</span>
              </div>
              <div class="summary-item">
                <span class="summary-dot remove"></span>
                <span class="summary-label">Removed: {diffResult.diffs.filter(d => d.Type === 'remove').length}</span>
              </div>
              <div class="summary-item">
                <span class="summary-dot change"></span>
                <span class="summary-label">Changed: {diffResult.diffs.filter(d => d.Type === 'change').length}</span>
              </div>
              <div class="summary-meta">
                {mode === 'files' ? `${diffResult.file1Lines} vs ${diffResult.file2Lines} lines` : `${diffResult.code1Lines} vs ${diffResult.code2Lines} lines`}
              </div>
            </div>
            
            <!-- Diff Lines -->
            {#if viewMode === 'unified'}
              <div class="diff-code">
                {#each diffResult.diffs as diff}
                  <div class="diff-line {getDiffTypeColor(diff.Type)}">
                    <div class="line-num">{diff.LineNum}</div>
                    <div class="line-icon {diff.Type}">{getDiffTypeIcon(diff.Type)}</div>
                    <div class="line-content">
                      {#if diff.Type === 'change'}
                        <div class="line-old">{diff.Old}</div>
                        <div class="line-new">{diff.New}</div>
                      {:else if diff.Type === 'remove'}
                        <span class="text-remove">{diff.Old}</span>
                      {:else}
                        <span class="text-add">{diff.New}</span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <!-- Side by Side View -->
              <div class="diff-side-by-side">
                <div class="side-panel">
                  <div class="side-header">Original</div>
                  {#each diffResult.diffs as diff}
                    <div class="side-line {diff.Type === 'remove' || diff.Type === 'change' ? 'highlight-remove' : ''}">
                      <div class="side-num">{diff.LineNum}</div>
                      <div class="side-content">
                        <span class="{diff.Type === 'remove' || diff.Type === 'change' ? 'text-remove' : ''}">{diff.Old || ''}</span>
                      </div>
                    </div>
                  {/each}
                </div>
                <div class="side-panel">
                  <div class="side-header">Modified</div>
                  {#each diffResult.diffs as diff}
                    <div class="side-line {diff.Type === 'add' || diff.Type === 'change' ? 'highlight-add' : ''}">
                      <div class="side-num">{diff.LineNum}</div>
                      <div class="side-content">
                        <span class="{diff.Type === 'add' || diff.Type === 'change' ? 'text-add' : ''}">{diff.New || ''}</span>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          {/if}
        {:else}
          <div class="diff-empty-state">
            <span class="empty-icon">◈</span>
            <p class="empty-desc">Select two {mode === 'files' ? 'files' : 'smart contracts'} to compare</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* === HOLOGRAM v6.1 Diff Viewer === */
  
  .diff-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-4, 16px);
  }
  
  .diff-modal {
    background: var(--void-mid, #12121c);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-xl, 16px);
    width: 100%;
    max-width: 1200px;
    max-height: 90vh;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }
  
  /* Header */
  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-4, 16px);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    background: var(--void-deep, #08080e);
  }
  
  .diff-header-left {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
  }
  
  .diff-header-icon {
    font-size: 24px;
    color: var(--cyan-400, #22d3ee);
  }
  
  .diff-title {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 700;
    color: var(--text-1, #f8f8fc);
  }
  
  .diff-close-btn {
    font-size: 20px;
    padding: var(--s-2, 8px);
    color: var(--text-4, #505068);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 200ms ease-out;
  }
  
  .diff-close-btn:hover {
    color: var(--text-1, #f8f8fc);
  }
  
  /* Mode Bar */
  .diff-mode-bar {
    padding: var(--s-4, 16px);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    background: rgba(18, 18, 28, 0.5);
  }
  
  .mode-tabs {
    display: flex;
    align-items: center;
    gap: var(--s-4, 16px);
  }
  
  .mode-tab-group,
  .view-tab-group {
    display: flex;
    background: var(--void-deep, #08080e);
    border-radius: var(--r-lg, 12px);
    padding: var(--s-1, 4px);
  }
  
  .view-tab-group {
    margin-left: auto;
  }
  
  .mode-tab {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    padding: var(--s-2, 8px) var(--s-4, 16px);
    border-radius: var(--r-lg, 12px);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-4, #505068);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .mode-tab:hover {
    color: var(--text-1, #f8f8fc);
  }
  
  .mode-tab.active {
    background: var(--cyan-500, #06b6d4);
    color: var(--void-pure, #000000);
  }
  
  .mode-icon {
    font-size: 14px;
  }
  
  .view-tab {
    padding: var(--s-1, 4px) var(--s-3, 12px);
    border-radius: var(--r-sm, 5px);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-4, #505068);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .view-tab:hover {
    color: var(--text-2, #a8a8b8);
  }
  
  .view-tab.active {
    background: var(--void-up, #181824);
    color: var(--text-2, #a8a8b8);
  }
  
  /* Form */
  .diff-form {
    padding: var(--s-4, 16px);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
  }
  
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-4, 16px);
  }
  
  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--s-2, 8px);
  }
  
  .form-label {
    font-size: 13px;
    color: var(--text-4, #505068);
  }
  
  .input-row {
    display: flex;
    gap: var(--s-2, 8px);
  }
  
  .input-field {
    flex: 1;
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-lg, 12px);
    color: var(--text-1, #f8f8fc);
    font-size: 13px;
    outline: none;
    transition: border-color 200ms ease-out;
  }
  
  .input-field::placeholder {
    color: var(--text-5, #404058);
  }
  
  .input-field:focus {
    border-color: var(--cyan-500, #06b6d4);
  }
  
  .input-field.mono {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }
  
  .form-actions {
    display: flex;
    gap: var(--s-2, 8px);
    margin-top: var(--s-4, 16px);
  }
  
  .btn-primary {
    padding: var(--s-2, 8px) var(--s-6, 24px);
    background: var(--emerald-400, #34d399);
    color: var(--void-pure, #000000);
    border-radius: var(--r-lg, 12px);
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: background 200ms ease-out;
  }
  
  .btn-primary:hover {
    background: var(--emerald-300, #6ee7b7);
  }
  
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .btn-secondary {
    padding: var(--s-2, 8px) var(--s-4, 16px);
    background: var(--void-up, #181824);
    color: var(--text-3, #707088);
    border-radius: var(--r-lg, 12px);
    border: none;
    cursor: pointer;
    transition: background 200ms ease-out;
  }
  
  .btn-secondary:hover {
    background: var(--void-surface, #1e1e2a);
  }
  
  /* Results */
  .diff-results {
    flex: 1;
    overflow: auto;
    max-height: 50vh;
    padding: var(--s-4, 16px);
  }
  
  .diff-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--s-12, 48px);
    text-align: center;
  }
  
  .empty-icon {
    font-size: 48px;
    color: var(--text-4, #505068);
    margin-bottom: var(--s-4, 16px);
  }
  
  .empty-icon.success {
    color: var(--status-ok, #34d399);
  }
  
  .empty-title {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: var(--s-2, 8px);
  }
  
  .empty-title.success {
    color: var(--status-ok, #34d399);
  }
  
  .empty-desc {
    color: var(--text-4, #505068);
  }
  
  /* Summary */
  .diff-summary {
    display: flex;
    align-items: center;
    gap: var(--s-6, 24px);
    margin-bottom: var(--s-4, 16px);
    padding: var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border-radius: var(--r-lg, 12px);
    font-size: 13px;
  }
  
  .summary-item {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
  }
  
  .summary-dot {
    width: 12px;
    height: 12px;
    border-radius: var(--r-xs, 3px);
  }
  
  .summary-dot.add {
    background: var(--status-ok, #34d399);
  }
  
  .summary-dot.remove {
    background: var(--status-err, #f87171);
  }
  
  .summary-dot.change {
    background: var(--status-warn, #fbbf24);
  }
  
  .summary-label {
    color: var(--text-4, #505068);
  }
  
  .summary-meta {
    margin-left: auto;
    color: var(--text-5, #404058);
  }
  
  /* Diff Code */
  .diff-code {
    background: var(--void-deep, #08080e);
    border-radius: var(--r-lg, 12px);
    overflow: hidden;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 13px;
  }
  
  .diff-line {
    display: flex;
  }
  
  .diff-line.diff-add {
    background: rgba(52, 211, 153, 0.15);
    border-left: 4px solid var(--status-ok, #34d399);
  }
  
  .diff-line.diff-remove {
    background: rgba(248, 113, 113, 0.15);
    border-left: 4px solid var(--status-err, #f87171);
  }
  
  .diff-line.diff-change {
    background: rgba(251, 191, 36, 0.15);
    border-left: 4px solid var(--status-warn, #fbbf24);
  }
  
  .line-num {
    width: 48px;
    flex-shrink: 0;
    padding: var(--s-1, 4px) var(--s-2, 8px);
    text-align: right;
    color: var(--text-5, #404058);
    border-right: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
  }
  
  .line-icon {
    width: 24px;
    flex-shrink: 0;
    text-align: center;
    padding: var(--s-1, 4px) 0;
  }
  
  .line-icon.add {
    color: var(--status-ok, #34d399);
  }
  
  .line-icon.remove {
    color: var(--status-err, #f87171);
  }
  
  .line-icon.change {
    color: var(--status-warn, #fbbf24);
  }
  
  .line-content {
    flex: 1;
    padding: var(--s-1, 4px) var(--s-2, 8px);
    overflow-x: auto;
    white-space: pre;
  }
  
  .line-old {
    color: rgba(248, 113, 113, 0.8);
    text-decoration: line-through;
    opacity: 0.7;
  }
  
  .line-new {
    color: rgba(52, 211, 153, 0.9);
  }
  
  .text-remove {
    color: rgba(248, 113, 113, 0.8);
  }
  
  .text-add {
    color: rgba(52, 211, 153, 0.9);
  }
  
  /* Side by Side */
  .diff-side-by-side {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-2, 8px);
  }
  
  .side-panel {
    background: var(--void-deep, #08080e);
    border-radius: var(--r-lg, 12px);
    overflow: hidden;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 13px;
  }
  
  .side-header {
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: var(--void-mid, #12121c);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    font-size: 12px;
    color: var(--text-4, #505068);
  }
  
  .side-line {
    display: flex;
  }
  
  .side-line.highlight-remove {
    background: rgba(248, 113, 113, 0.1);
  }
  
  .side-line.highlight-add {
    background: rgba(52, 211, 153, 0.1);
  }
  
  .side-num {
    width: 40px;
    flex-shrink: 0;
    padding: var(--s-1, 4px) var(--s-2, 8px);
    text-align: right;
    color: var(--text-5, #404058);
    border-right: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    font-size: 12px;
  }
  
  .side-content {
    flex: 1;
    padding: var(--s-1, 4px) var(--s-2, 8px);
    overflow-x: auto;
    white-space: pre;
    font-size: 12px;
    color: var(--text-4, #505068);
  }
</style>

