<script>
  import { createEventDispatcher } from 'svelte';
  import { Upload, FolderDown } from 'lucide-svelte';
  import { SelectFiles } from '../../../wailsjs/go/main/App';
  
  const dispatch = createEventDispatcher();
  
  let isDragging = false;
  let isLoading = false;
  
  function handleDragOver(event) {
    event.preventDefault();
    isDragging = true;
  }
  
  function handleDragLeave() {
    isDragging = false;
  }
  
  async function handleDrop(event) {
    event.preventDefault();
    isDragging = false;
    
    const items = event.dataTransfer.items;
    const files = [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          await processEntry(entry, '', files);
        }
      }
    }
    
    if (files.length > 0) {
      dispatch('filesStaged', { files });
    }
  }
  
  async function processEntry(entry, basePath, files) {
    if (entry.isFile) {
      const file = await getFile(entry);
      files.push({
        name: entry.name,
        path: basePath + entry.name,
        subDir: basePath || '/',
        size: file.size,
        type: file.type || detectMimeType(entry.name),
        file: file,
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await readAllDirectoryEntries(reader);
      const newBasePath = basePath + entry.name + '/';
      
      for (const childEntry of entries) {
        await processEntry(childEntry, newBasePath, files);
      }
    }
  }
  
  function getFile(entry) {
    return new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
  }
  
  function readAllDirectoryEntries(reader) {
    return new Promise((resolve, reject) => {
      const entries = [];
      
      function readEntries() {
        reader.readEntries((batch) => {
          if (batch.length === 0) {
            resolve(entries);
          } else {
            entries.push(...batch);
            readEntries();
          }
        }, reject);
      }
      
      readEntries();
    });
  }
  
  function detectMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
      'html': 'text/html',
      'htm': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'json': 'application/json',
      'svg': 'image/svg+xml',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'woff': 'font/woff',
      'woff2': 'font/woff2',
      'ttf': 'font/ttf',
      'ico': 'image/x-icon',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
  
  async function openFilePicker() {
    console.log('[DropZone] openFilePicker called - using Wails native dialog');
    isLoading = true;
    
    try {
      const result = await SelectFiles();
      console.log('[DropZone] SelectFiles result:', result);
      
      if (result.success && result.files && result.files.length > 0) {
        // Transform files to match expected format
        const files = result.files.map(f => ({
          name: f.name,
          path: f.path,
          subDir: f.subDir || '/',
          size: f.size,
          type: f.type,
          data: f.data, // File content from backend
        }));
        
        console.log('[DropZone] Dispatching filesStaged with', files.length, 'files');
        dispatch('filesStaged', { files });
      } else if (!result.success) {
        console.log('[DropZone] No files selected or error:', result.error);
      }
    } catch (err) {
      console.error('[DropZone] Error opening file picker:', err);
    } finally {
      isLoading = false;
    }
  }
</script>

<!-- v6.1 DropZone -->
<div
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
  class="dropzone"
  class:active={isDragging}
  class:loading={isLoading}
  on:click={openFilePicker}
  on:keydown={(e) => e.key === 'Enter' && openFilePicker()}
  role="button"
  tabindex="0"
>
  <div class="dropzone-icon">
    {#if isLoading}
      <div class="spinner"></div>
    {:else if isDragging}
      <FolderDown size={40} strokeWidth={1.5} />
    {:else}
      <Upload size={40} strokeWidth={1.5} />
    {/if}
  </div>
  
  <p class="dropzone-title">
    {#if isLoading}
      Loading file...
    {:else if isDragging}
      Drop to upload
    {:else}
      Drag & drop a file
    {/if}
  </p>
  <p class="dropzone-hint">
    Or click to browse. Supports HTML, CSS, JS, SVG, images, and more.
  </p>
</div>

<style>
  .spinner {
    width: 40px;
    height: 40px;
    border: 2px solid rgba(34, 211, 238, 0.2);
    border-top-color: var(--cyan-400, #22d3ee);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .loading {
    pointer-events: none;
    opacity: 0.7;
  }
</style>
