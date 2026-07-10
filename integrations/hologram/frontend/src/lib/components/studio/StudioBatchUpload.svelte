<script>
  import { createEventDispatcher } from 'svelte';
  import { FolderDown, FolderUp } from 'lucide-svelte';
  import BatchUpload from '../BatchUpload.svelte';

  export let batchFolderPath = '';
  export let batchDragging = false;
  export let batchDropzoneElement = null;
  export let selectFolder = async () => '';

  const dispatch = createEventDispatcher();
</script>

<div class="content-section">
  <h2 class="content-section-title">Batch Upload</h2>
  <p class="content-section-desc">Upload an entire folder to create DOCs + INDEX in one operation.</p>
  
  {#if !batchFolderPath}
    <div 
      bind:this={batchDropzoneElement}
      class="dropzone"
      class:active={batchDragging}
      on:dragover|preventDefault={() => { batchDragging = true; }}
      on:dragleave={() => { batchDragging = false; }}
      on:drop|preventDefault={() => { batchDragging = false; }}
      on:click={async () => {
        const selected = await selectFolder();
        if (selected) {
          batchFolderPath = selected;
        }
      }}
      role="button"
      tabindex="0"
    >
      <div class="dropzone-icon">
        {#if batchDragging}
          <FolderDown size={40} strokeWidth={1.5} />
        {:else}
          <FolderUp size={40} strokeWidth={1.5} />
        {/if}
      </div>
      <p class="dropzone-title">
        {batchDragging ? 'Drop folder here' : 'Drag & drop a folder'}
      </p>
      <p class="dropzone-hint">
        Or click to browse. All files will be scanned for batch deployment.
      </p>
    </div>
  {:else}
    <BatchUpload 
      folderPath={batchFolderPath} 
      on:complete
      on:preview
    />
    
    <button
      on:click={() => batchFolderPath = ''}
      class="btn btn-ghost back-link"
    >
      ← Choose different folder
    </button>
  {/if}
</div>
