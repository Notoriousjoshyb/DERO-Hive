<script>
  import { createEventDispatcher } from 'svelte';
  import { GetCommitHistoryWithLabels, GetCommitContent, DiffCommits } from '../../../wailsjs/go/main/App.js';
  import { Icons } from './holo';
  
  export let scid = '';
  export let show = false;
  
  const dispatch = createEventDispatcher();
  
  let commits = [];
  let loading = true;
  let loadingContent = false;
  let selectedCommit = null;
  let compareMode = false;
  let compareCommitA = null;
  let compareCommitB = null;
  let diffResult = null;
  let selectedFile = null; // For viewing individual files
  
  $: if (scid && show) {
    loadHistory();
  }
  
  // Get file count from commit files
  $: fileCount = selectedCommit?.files ? Object.keys(selectedCommit.files).length : 0;
  
  // Get files list from selected commit
  $: fileList = selectedCommit?.files ? Object.keys(selectedCommit.files) : [];
  
  async function loadHistory() {
    if (!scid) return;
    
    loading = true;
    try {
      const result = await GetCommitHistoryWithLabels(scid);
      if (result.success) {
        commits = result.commits || [];
      }
    } catch (error) {
      console.error('Failed to load commit history:', error);
    } finally {
      loading = false;
    }
  }
  
  async function viewCommit(commit) {
    if (compareMode) {
      if (!compareCommitA) {
        compareCommitA = commit;
      } else if (!compareCommitB) {
        compareCommitB = commit;
        await runDiff();
      }
    } else {
      selectedCommit = { ...commit };
      selectedFile = null;
      loadingContent = true;
      
      try {
        const result = await GetCommitContent(scid, commit.number);
        if (result.success) {
          selectedCommit = { 
            ...commit, 
            files: result.files || {},
            docs: result.docs || [],
            durl: result.durl || '',
            message: result.message,
            warning: result.warning
          };
          
          // Auto-select first file if available
          const files = Object.keys(result.files || {});
          if (files.length > 0) {
            selectedFile = files[0];
          }
        }
      } catch (error) {
        console.error('Failed to get commit content:', error);
      } finally {
        loadingContent = false;
      }
    }
  }
  
  async function runDiff() {
    if (!compareCommitA || !compareCommitB) return;
    
    try {
      const result = await DiffCommits(scid, compareCommitA.number, compareCommitB.number);
      if (result.success) {
        diffResult = result;
      }
    } catch (error) {
      console.error('Diff failed:', error);
    }
  }
  
  function toggleCompareMode() {
    compareMode = !compareMode;
    compareCommitA = null;
    compareCommitB = null;
    diffResult = null;
    selectedCommit = null;
    selectedFile = null;
  }
  
  function clearSelection() {
    compareCommitA = null;
    compareCommitB = null;
    diffResult = null;
    selectedCommit = null;
    selectedFile = null;
  }
  
  function close() {
    show = false;
    dispatch('close');
  }
  
  function formatHeight(height) {
    if (!height) return 'Unknown';
    return height.toLocaleString();
  }
  
  // File type to icon name mapping (uses Lucide icons via Icons component)
  function getFileIconName(filename) {
    if (!filename) return 'file';
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'html': return 'globe';
      case 'css': return 'palette';
      case 'js': return 'zap';
      case 'json': return 'code';
      case 'svg': return 'layers';
      case 'md': return 'file';
      default: return 'file';
    }
  }
  
  function getStatusIcon(status) {
    switch (status) {
      case 'added': return '+';
      case 'removed': return '-';
      case 'modified': return '~';
      default: return '●';
    }
  }
  
  function getStatusClass(status) {
    switch (status) {
      case 'added': return 'status-added';
      case 'removed': return 'status-removed';
      case 'modified': return 'status-modified';
      default: return '';
    }
  }
</script>

{#if show}
  <div class="vh-backdrop" on:click={close}>
    <div class="vh-modal" on:click|stopPropagation>
      <!-- Header -->
      <div class="vh-header">
        <div>
          <h2 class="vh-title">
            <span class="vh-icon">◎</span>
            Version History
          </h2>
          <p class="vh-scid">{scid}</p>
        </div>
        <div class="vh-header-actions">
          <button
            on:click={toggleCompareMode}
            class="btn-compare {compareMode ? 'active' : ''}"
          >
            {compareMode ? '✓ Compare Mode' : 'Compare Versions'}
          </button>
          <button on:click={close} class="btn-close">✕</button>
        </div>
      </div>
      
      <!-- Content -->
      <div class="vh-content">
        <!-- Commit Timeline -->
        <div class="vh-timeline">
          {#if loading}
            <div class="vh-loading">
              <div class="spinner"></div>
              <p class="loading-text">Loading history...</p>
            </div>
          {:else if commits.length === 0}
            <div class="vh-empty">
              <span class="empty-icon">○</span>
              <p>No version history found</p>
            </div>
          {:else}
            <div class="timeline-container">
              <!-- Timeline line -->
              <div class="timeline-line"></div>
              
              {#each commits as commit}
                <button
                  on:click={() => viewCommit(commit)}
                  class="commit-item {(compareMode && (compareCommitA?.number === commit.number || compareCommitB?.number === commit.number)) || selectedCommit?.number === commit.number ? 'active' : ''}"
                >
                  <!-- Dot -->
                  <div class="commit-dot {commit.isCurrent ? 'current' : ''}"></div>
                  
                  <div class="commit-info">
                    <div class="commit-header">
                      <span class="commit-version">v{commit.number}</span>
                      {#if commit.isCurrent}
                        <span class="badge-current">Current</span>
                      {/if}
                    </div>
                    {#if commit.label}
                      <p class="commit-label">{commit.label}</p>
                    {/if}
                    {#if commit.height}
                      <p class="commit-meta">Block {formatHeight(commit.height)}</p>
                    {/if}
                    {#if commit.txid}
                      <p class="commit-txid">{commit.txid.substring(0, 16)}...</p>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        
        <!-- Detail View -->
        <div class="vh-detail">
          {#if compareMode && diffResult}
            <!-- Diff View -->
            <div class="diff-header">
              <h3 class="diff-title">
                Comparing v{compareCommitA.number} → v{compareCommitB.number}
              </h3>
              <div class="diff-header-row">
                {#if diffResult.summary}
                  <span class="diff-summary">{diffResult.summary}</span>
                {/if}
                <button on:click={clearSelection} class="btn-clear">
                  Clear selection
                </button>
              </div>
            </div>
            
            <!-- File-based diffs -->
              {#if diffResult.fileDiffs && diffResult.fileDiffs.length > 0}
              <div class="file-diff-list">
                {#each diffResult.fileDiffs as fileDiff}
                  <div class="file-diff-item">
                    <div class="file-diff-header {getStatusClass(fileDiff.status)}">
                      <span class="file-icon"><Icons name={getFileIconName(fileDiff.fileName)} size={14} /></span>
                      <span class="file-name">{fileDiff.fileName}</span>
                      <span class="file-status-badge {fileDiff.status}">
                        {getStatusIcon(fileDiff.status)} {fileDiff.status}
                      </span>
                    </div>
                    
                    {#if fileDiff.lineDiffs && fileDiff.lineDiffs.length > 0}
                      <div class="line-diff-list">
                        {#each fileDiff.lineDiffs as change}
                          <div class="diff-change {change.type}">
                            <span class="diff-line-num">L{change.line}</span>
                            {#if change.type === 'modified'}
                              <div class="diff-old">- {change.oldContent}</div>
                              <div class="diff-new">+ {change.newContent}</div>
                            {:else}
                              <span class="diff-symbol">{change.type === 'added' ? '+' : '-'}</span>
                              <span class="diff-content">{change.content}</span>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <p class="no-line-diff">
                        {#if fileDiff.status === 'added'}
                          New file added
                        {:else if fileDiff.status === 'removed'}
                          File removed
                        {:else}
                          No line changes
                        {/if}
                      </p>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else if diffResult.diff && diffResult.diff.length > 0}
              <!-- Fallback to legacy diff format -->
              <div class="diff-list">
                {#each diffResult.diff as change}
                  <div class="diff-change {change.type}">
                    <span class="diff-line-num">Line {change.line}:</span>
                    {#if change.type === 'modified'}
                      <div class="diff-old">{change.oldContent}</div>
                      <div class="diff-new">{change.newContent}</div>
                    {:else}
                      <span class="diff-symbol">{change.type === 'added' ? '+' : '-'}</span>
                      {change.content}
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="no-diff">No differences found</p>
            {/if}
          {:else if compareMode}
            <div class="vh-placeholder">
              <span class="placeholder-icon">◈</span>
              <p class="placeholder-text">Select two versions to compare</p>
              <p class="placeholder-hint">
                {#if compareCommitA}
                  Selected: v{compareCommitA.number} → Select another version
                {:else}
                  Click on a version to start
                {/if}
              </p>
            </div>
          {:else if selectedCommit}
            <!-- Single Commit View -->
            <div class="commit-detail">
              <h3 class="detail-title">
                Version {selectedCommit.number}
                {#if selectedCommit.label}
                  <span class="commit-label-badge">{selectedCommit.label}</span>
                {/if}
                {#if selectedCommit.isCurrent}
                  <span class="badge-current">Current</span>
                {/if}
              </h3>
              
              {#if selectedCommit.warning}
                <div class="warning-banner">
                  <span class="warning-icon"><Icons name="warning" size={16} /></span>
                  {selectedCommit.warning}
                </div>
              {/if}
              
              <div class="detail-grid">
                {#if selectedCommit.height}
                  <div class="detail-card">
                    <span class="detail-label">Block Height</span>
                    <span class="detail-value">{formatHeight(selectedCommit.height)}</span>
                  </div>
                {/if}
                {#if selectedCommit.txid}
                  <div class="detail-card">
                    <span class="detail-label">Transaction</span>
                    <span class="detail-value mono">{selectedCommit.txid}</span>
                  </div>
                {/if}
                {#if selectedCommit.durl}
                  <div class="detail-card">
                    <span class="detail-label">dURL</span>
                    <span class="detail-value">{selectedCommit.durl}</span>
                  </div>
                {/if}
                {#if fileCount > 0}
                  <div class="detail-card">
                    <span class="detail-label">Files</span>
                    <span class="detail-value">{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
                  </div>
                {/if}
              </div>
              
              {#if loadingContent}
                <div class="loading-content">
                  <div class="spinner-small"></div>
                  <span>Loading content...</span>
                </div>
              {:else if fileList.length > 0}
                <!-- File tabs and content viewer -->
                <div class="file-browser">
                  <div class="file-tabs">
                    {#each fileList as filename}
                      <button 
                        class="file-tab {selectedFile === filename ? 'active' : ''}"
                        on:click={() => selectedFile = filename}
                      >
                        <span class="tab-icon"><Icons name={getFileIconName(filename)} size={14} /></span>
                        {filename}
                      </button>
                    {/each}
                  </div>
                  
                  {#if selectedFile && selectedCommit.files[selectedFile]}
                    <div class="content-preview">
                      <div class="content-header">
                        <span class="content-filename">{selectedFile}</span>
                        <span class="content-size">{selectedCommit.files[selectedFile].length} chars</span>
                      </div>
                      <pre class="content-code">{selectedCommit.files[selectedFile]}</pre>
                    </div>
                  {/if}
                </div>
              {:else if selectedCommit.message}
                <div class="no-content-message">
                  <p>{selectedCommit.message}</p>
                </div>
              {/if}
              
              <!-- DOC SCIDs if available -->
              {#if selectedCommit.docs && selectedCommit.docs.length > 0}
                <div class="docs-section">
                  <h4 class="docs-title">DOC Smart Contracts</h4>
                  <div class="docs-list">
                    {#each selectedCommit.docs as docScid}
                      <div class="doc-item">
                        <span class="doc-icon"><Icons name="file" size={14} /></span>
                        <span class="doc-scid">{docScid}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
              
              <!-- Actions -->
              <div class="detail-actions">
                <button
                  class="btn-action"
                  on:click={() => dispatch('revert', selectedCommit)}
                >
                  ← Revert to this version
                </button>
                <button
                  class="btn-action"
                  on:click={() => dispatch('clone', selectedCommit)}
                >
                  ◇ Clone this version
                </button>
              </div>
            </div>
          {:else}
            <div class="vh-placeholder">
              <span class="placeholder-icon">◎</span>
              <p class="placeholder-text">Select a version to view details</p>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* === HOLOGRAM v6.1 Version History === */
  
  .vh-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    padding: var(--s-4);
  }
  
  .vh-modal {
    background: var(--void-mid);
    border-radius: var(--r-xl);
    border: 1px solid var(--border-dim);
    width: 100%;
    max-width: 900px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
  }
  
  /* Header */
  .vh-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-4) var(--s-6);
    border-bottom: 1px solid var(--border-dim);
  }
  
  .vh-title {
    font-family: var(--font-mono);
    font-size: 20px;
    font-weight: 700;
    color: var(--text-1);
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .vh-icon {
    color: var(--cyan-400);
  }
  
  .vh-scid {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-5);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 400px;
  }
  
  .vh-header-actions {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  
  .btn-compare {
    padding: var(--s-1) var(--s-3);
    border-radius: var(--r-lg);
    font-size: 13px;
    font-weight: 500;
    background: var(--void-up);
    color: var(--text-3);
    border: none;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .btn-compare:hover {
    background: var(--void-surface);
  }
  
  .btn-compare.active {
    background: var(--cyan-500);
    color: var(--void-pure);
  }
  
  .btn-close {
    font-size: 20px;
    color: var(--text-4);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 200ms ease-out;
  }
  
  .btn-close:hover {
    color: var(--text-1);
  }
  
  /* Content */
  .vh-content {
    flex: 1;
    overflow: hidden;
    display: flex;
  }
  
  /* Timeline */
  .vh-timeline {
    width: 288px;
    border-right: 1px solid var(--border-dim);
    overflow-y: auto;
    padding: var(--s-4);
  }
  
  .vh-loading,
  .vh-empty {
    text-align: center;
    padding: var(--s-8);
    color: var(--text-4);
  }
  
  .spinner {
    width: 32px;
    height: 32px;
    border: 2px solid var(--cyan-500);
    border-top-color: transparent;
    border-radius: var(--r-full);
    animation: spin 0.6s linear infinite;
    margin: 0 auto var(--s-2);
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .empty-icon {
    font-size: 28px;
    display: block;
    margin-bottom: var(--s-2);
  }
  
  .timeline-container {
    position: relative;
  }
  
  .timeline-line {
    position: absolute;
    left: 16px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--void-surface);
  }
  
  .commit-item {
    position: relative;
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-3);
    border-radius: var(--r-lg);
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 200ms ease-out;
    margin-bottom: var(--s-2);
  }
  
  .commit-item:hover {
    background: var(--void-up);
  }
  
  .commit-item.active {
    background: rgba(6, 182, 212, 0.1);
    border-color: rgba(6, 182, 212, 0.3);
  }
  
  .commit-dot {
    position: relative;
    z-index: 10;
    width: 12px;
    height: 12px;
    border-radius: var(--r-full);
    margin-top: 4px;
    flex-shrink: 0;
    background: var(--void-hover);
  }
  
  .commit-dot.current {
    background: var(--status-ok);
  }
  
  .commit-info {
    flex: 1;
    min-width: 0;
  }
  
  .commit-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .commit-version {
    font-weight: 500;
    color: var(--text-2);
  }
  
  .badge-current {
    padding: 2px 6px;
    font-size: 10px;
    background: rgba(52, 211, 153, 0.2);
    color: var(--status-ok);
    border-radius: var(--r-xs);
  }
  
  .commit-meta,
  .commit-txid {
    font-size: 12px;
    color: var(--text-5);
  }
  
  .commit-txid {
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  /* Detail View */
  .vh-detail {
    flex: 1;
    overflow-y: auto;
    padding: var(--s-6);
  }
  
  .vh-placeholder {
    text-align: center;
    padding: var(--s-16);
    color: var(--text-4);
  }
  
  .placeholder-icon {
    font-size: 40px;
    display: block;
    margin-bottom: var(--s-4);
    color: var(--text-5);
  }
  
  .placeholder-text {
    margin-bottom: var(--s-2);
  }
  
  .placeholder-hint {
    font-size: 13px;
    color: var(--text-5);
  }
  
  /* Diff View */
  .diff-header {
    margin-bottom: var(--s-4);
  }
  
  .diff-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-2);
    margin-bottom: var(--s-2);
  }
  
  .btn-clear {
    font-size: 13px;
    color: var(--cyan-400);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: color 200ms ease-out;
  }
  
  .btn-clear:hover {
    color: var(--cyan-300);
  }
  
  .diff-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  
  .diff-change {
    font-family: var(--font-mono);
    font-size: 13px;
    padding: var(--s-2);
    border-radius: var(--r-sm);
    border-left: 2px solid;
  }
  
  .diff-change.added {
    background: rgba(52, 211, 153, 0.1);
    border-color: var(--status-ok);
    color: var(--status-ok);
  }
  
  .diff-change.removed {
    background: rgba(248, 113, 113, 0.1);
    border-color: var(--status-err);
    color: var(--status-err);
  }
  
  .diff-change.modified {
    background: rgba(251, 191, 36, 0.1);
    border-color: var(--status-warn);
    color: var(--status-warn);
  }
  
  .diff-line-num {
    color: var(--text-5);
    margin-right: var(--s-2);
  }
  
  .diff-old {
    color: var(--status-err);
    text-decoration: line-through;
  }
  
  .diff-new {
    color: var(--status-ok);
  }
  
  .diff-symbol {
    margin-right: var(--s-1);
  }
  
  .no-diff {
    text-align: center;
    padding: var(--s-8);
    color: var(--text-4);
  }
  
  /* Commit Detail */
  .commit-detail {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  
  .detail-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  
  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-4);
  }
  
  .detail-card {
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-lg);
  }
  
  .detail-label {
    font-size: 12px;
    color: var(--text-5);
    display: block;
    margin-bottom: var(--s-1);
  }
  
  .detail-value {
    font-family: var(--font-mono);
    color: var(--text-2);
  }
  
  .detail-value.mono {
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  
  .content-preview {
    background: var(--void-deep);
    border-radius: var(--r-lg);
    padding: var(--s-4);
    overflow-x: auto;
  }
  
  .content-preview pre {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-3);
    margin: 0;
  }
  
  .detail-actions {
    display: flex;
    gap: var(--s-3);
    margin-top: var(--s-2);
  }
  
  .btn-action {
    padding: var(--s-2) var(--s-4);
    background: var(--void-up);
    color: var(--text-3);
    border-radius: var(--r-lg);
    border: none;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .btn-action:hover {
    background: var(--void-surface);
    color: var(--text-2);
  }
  
  /* === Enhanced Version Control Styles === */
  
  /* Commit labels */
  .commit-label {
    font-size: 11px;
    color: var(--cyan-400);
    font-style: italic;
  }
  
  .commit-label-badge {
    font-size: 12px;
    color: var(--text-4);
    font-weight: 400;
    margin-left: var(--s-2);
  }
  
  /* Warning banner */
  .warning-banner {
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: var(--r-lg);
    padding: var(--s-3);
    margin-bottom: var(--s-4);
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--status-warn);
    font-size: 13px;
  }
  
  .warning-icon {
    display: flex;
    align-items: center;
    color: var(--status-warn);
  }
  
  /* Loading content */
  .loading-content {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-3);
    padding: var(--s-8);
    color: var(--text-4);
  }
  
  .spinner-small {
    width: 20px;
    height: 20px;
    border: 2px solid var(--cyan-500);
    border-top-color: transparent;
    border-radius: var(--r-full);
    animation: spin 0.6s linear infinite;
  }
  
  /* File browser */
  .file-browser {
    margin-top: var(--s-4);
  }
  
  .file-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-bottom: var(--s-3);
  }
  
  .file-tab {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-2) var(--s-3);
    background: var(--void-deep);
    border: 1px solid var(--border-dim);
    border-radius: var(--r-md);
    color: var(--text-4);
    font-size: 13px;
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  
  .file-tab:hover {
    background: var(--void-up);
    color: var(--text-3);
  }
  
  .file-tab.active {
    background: rgba(6, 182, 212, 0.15);
    border-color: rgba(6, 182, 212, 0.3);
    color: var(--cyan-400);
  }
  
  .tab-icon {
    display: flex;
    align-items: center;
  }
  
  /* Content preview enhancements */
  .content-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s-2) var(--s-3);
    background: var(--void-up);
    border-radius: var(--r-md) var(--r-md) 0 0;
    border-bottom: 1px solid var(--border-dim);
  }
  
  .content-filename {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-2);
  }
  
  .content-size {
    font-size: 11px;
    color: var(--text-5);
  }
  
  .content-code {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-3);
    margin: 0;
    padding: var(--s-4);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
  }
  
  .no-content-message {
    text-align: center;
    padding: var(--s-6);
    color: var(--text-4);
  }
  
  /* DOCs section */
  .docs-section {
    margin-top: var(--s-4);
    padding-top: var(--s-4);
    border-top: 1px solid var(--border-dim);
  }
  
  .docs-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-3);
    margin-bottom: var(--s-3);
  }
  
  .docs-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  
  .doc-item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-md);
  }
  
  .doc-icon {
    display: flex;
    align-items: center;
    color: var(--text-4);
  }
  
  .doc-scid {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  /* File-based diff styles */
  .diff-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--s-2);
  }
  
  .diff-summary {
    font-size: 13px;
    color: var(--text-3);
    padding: var(--s-1) var(--s-2);
    background: var(--void-up);
    border-radius: var(--r-sm);
  }
  
  .file-diff-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  
  .file-diff-item {
    background: var(--void-deep);
    border-radius: var(--r-lg);
    overflow: hidden;
  }
  
  .file-diff-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3);
    border-bottom: 1px solid var(--border-dim);
  }
  
  .file-diff-header.status-added {
    background: rgba(52, 211, 153, 0.1);
  }
  
  .file-diff-header.status-removed {
    background: rgba(248, 113, 113, 0.1);
  }
  
  .file-diff-header.status-modified {
    background: rgba(251, 191, 36, 0.1);
  }
  
  .file-icon {
    display: flex;
    align-items: center;
    color: var(--text-3);
  }
  
  .file-name {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-2);
  }
  
  .file-status-badge {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: var(--r-xs);
    text-transform: uppercase;
    font-weight: 500;
  }
  
  .file-status-badge.added {
    background: rgba(52, 211, 153, 0.2);
    color: var(--status-ok);
  }
  
  .file-status-badge.removed {
    background: rgba(248, 113, 113, 0.2);
    color: var(--status-err);
  }
  
  .file-status-badge.modified {
    background: rgba(251, 191, 36, 0.2);
    color: var(--status-warn);
  }
  
  .line-diff-list {
    padding: var(--s-2);
    max-height: 200px;
    overflow-y: auto;
  }
  
  .diff-content {
    word-break: break-word;
  }
  
  .no-line-diff {
    padding: var(--s-3);
    text-align: center;
    color: var(--text-5);
    font-size: 13px;
    font-style: italic;
  }
</style>

