<script>
  import { onMount } from 'svelte';
  import { Copy, AtSign, Check } from 'lucide-svelte';
  import { GetNameForAddress } from '../../../wailsjs/go/main/App.js';
  import { toast } from '../stores/appState.js';
  
  /** The DERO address to display */
  export let address = '';
  
  /** Whether to truncate the address */
  export let truncate = true;
  
  /** Whether to show the copy button */
  export let showCopy = true;
  
  /** Size variant: 'xs', 'sm', 'md', 'lg' */
  export let size = 'sm';
  
  /** Whether to show the full address on hover */
  export let showFullOnHover = true;
  
  /** Click handler - if provided, makes the address clickable */
  export let onClick = null;
  
  let nrsName = '';
  let loading = false;
  let copied = false;
  let lookupAttempted = false;
  
  // Reactively lookup name when address changes
  $: if (address && !lookupAttempted) {
    lookupName(address);
  }
  
  // Reset state when address changes
  $: if (address) {
    lookupAttempted = false;
    nrsName = '';
  }
  
  async function lookupName(addr) {
    if (!addr || !addr.startsWith('dero1')) {
      lookupAttempted = true;
      return;
    }
    
    loading = true;
    lookupAttempted = true;
    
    try {
      const result = await GetNameForAddress(addr);
      if (result.found && result.name) {
        nrsName = result.name;
      }
    } catch (e) {
      // Silently fail - just show address without name
    } finally {
      loading = false;
    }
  }
  
  function truncateAddress(addr) {
    if (!addr) return '';
    if (!truncate) return addr;
    
    // Different truncation based on size
    switch (size) {
      case 'xs':
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      case 'sm':
        return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
      case 'md':
        return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
      case 'lg':
        return `${addr.slice(0, 14)}...${addr.slice(-10)}`;
      default:
        return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
    }
  }
  
  async function copyAddress() {
    if (!address) return;
    
    try {
      await navigator.clipboard.writeText(address);
      copied = true;
      toast.success('Address copied!');
      setTimeout(() => copied = false, 2000);
    } catch (e) {
      toast.error('Failed to copy');
    }
  }
  
  function handleClick() {
    if (onClick) {
      onClick(address);
    }
  }
</script>

<span 
  class="address-display size-{size}" 
  class:clickable={onClick}
  class:has-name={nrsName}
  title={showFullOnHover ? address : ''}
  on:click={handleClick}
  on:keydown={(e) => e.key === 'Enter' && handleClick()}
  role={onClick ? 'button' : 'text'}
  tabindex={onClick ? 0 : -1}
>
  {#if nrsName}
    <span class="nrs-badge">
      <AtSign size={size === 'xs' ? 8 : size === 'sm' ? 10 : 12} strokeWidth={2} />
      <span class="nrs-name">{nrsName}</span>
    </span>
    <span class="nrs-separator">•</span>
  {/if}
  
  <span class="address-text" class:dimmed={nrsName}>
    {truncateAddress(address)}
  </span>
  
  {#if showCopy}
    <button 
      class="copy-btn" 
      on:click|stopPropagation={copyAddress} 
      title="Copy full address"
      class:copied
    >
      {#if copied}
        <Check size={size === 'xs' ? 8 : size === 'sm' ? 10 : 12} strokeWidth={2} />
      {:else}
        <Copy size={size === 'xs' ? 8 : size === 'sm' ? 10 : 12} strokeWidth={1.5} />
      {/if}
    </button>
  {/if}
</span>

<style>
  .address-display {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    transition: all 0.15s ease;
  }
  
  .address-display.clickable {
    cursor: pointer;
  }
  
  .address-display.clickable:hover {
    color: var(--c-cyan, #22d3ee);
  }
  
  /* Size variants */
  .size-xs { font-size: 10px; gap: 4px; }
  .size-sm { font-size: 11px; gap: 4px; }
  .size-md { font-size: 13px; gap: 8px; }
  .size-lg { font-size: 14px; gap: 8px; }
  
  /* NRS Name Badge */
  .nrs-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--c-cyan, #22d3ee);
    font-weight: 500;
    padding: 4px 8px;
    background: rgba(34, 211, 238, 0.1);
    border: 1px solid rgba(34, 211, 238, 0.2);
    border-radius: var(--r-xs);
  }
  
  .size-xs .nrs-badge { padding: 0 4px 0 2px; border-radius: 3px; }
  .size-lg .nrs-badge { padding: 2px 8px 2px 5px; border-radius: 5px; }
  
  .nrs-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .nrs-separator {
    color: var(--text-4, #505068);
    font-size: 0.7em;
    margin: 0 1px;
  }
  
  /* Address Text */
  .address-text {
    color: var(--text-2, #a8a8b8);
    transition: color 0.15s;
  }
  
  .address-text.dimmed {
    color: var(--text-4, #505068);
    font-size: 0.92em;
  }
  
  /* Copy Button */
  .copy-btn {
    background: transparent;
    border: none;
    color: var(--text-4, #505068);
    cursor: pointer;
    padding: 2px;
    margin-left: 2px;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, transform 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
  }
  
  .address-display:hover .copy-btn {
    opacity: 1;
  }
  
  .copy-btn:hover {
    color: var(--c-cyan, #22d3ee);
    background: rgba(34, 211, 238, 0.1);
  }
  
  .copy-btn.copied {
    color: var(--status-ok, #22c55e);
    opacity: 1;
  }
  
  .copy-btn:active {
    transform: scale(0.95);
  }
</style>

