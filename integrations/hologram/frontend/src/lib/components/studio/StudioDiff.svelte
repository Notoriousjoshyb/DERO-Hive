<script>
  import { FileText, Layers } from 'lucide-svelte';

  export let onOpenDiffViewer = () => {};
</script>

<div class="content-section">
  <h2 class="content-section-title">Code Diff Viewer</h2>
  <p class="content-section-desc">Compare local files or smart contract code to see differences.</p>
  
  <div class="diff-grid">
    <!-- Compare Local Files -->
    <button on:click={onOpenDiffViewer} class="content-card diff-option">
      <div class="diff-option-head">
        <FileText size={24} class="diff-option-icon cyan" />
        <h3 class="diff-option-title">Local Files</h3>
      </div>
      <p class="diff-option-desc">Compare two files from your computer to see what changed.</p>
    </button>
    
    <!-- Compare Smart Contracts -->
    <button on:click={onOpenDiffViewer} class="content-card diff-option">
      <div class="diff-option-head">
        <Layers size={24} class="diff-option-icon emerald" />
        <h3 class="diff-option-title">Smart Contracts</h3>
      </div>
      <p class="diff-option-desc">Compare two deployed smart contracts by their SCID.</p>
    </button>
  </div>
  
  <div class="info-panel">
    <div class="info-panel-icon">◎</div>
    <div class="info-panel-content">
      <p class="info-panel-title">Use Cases</p>
      <ul class="info-list">
        <li>Compare your local code with deployed SC code</li>
        <li>Track changes between different versions</li>
        <li>Review differences before updating an INDEX</li>
        <li>Verify code integrity after deployment</li>
      </ul>
    </div>
  </div>
</div>
