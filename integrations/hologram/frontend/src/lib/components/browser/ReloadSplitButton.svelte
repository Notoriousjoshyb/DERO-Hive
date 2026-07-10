<script>
  /**
   * ReloadSplitButton — URL bar reload control with an attached chevron
   * dropdown exposing three reload modes (normal, hard, empty cache).
   *
   * Behavior mirrors Chromium's reload button:
   *   - Left half (arrow icon) : click → emit `reload`
   *   - Right half (chevron)    : click → open dropdown
   *   - Right-click anywhere    : open dropdown
   *
   * The parent is responsible for wiring event handlers to the backend
   * (`ClearAppCache` + a subsequent navigate).
   */
  import { createEventDispatcher } from 'svelte';
  import { RotateCcw, RefreshCw, Trash2, ChevronDown } from 'lucide-svelte';

  export let disabled = false;
  /** When true, the "Empty Cache & Reload" entry will warn about removing
   *  the offline-prefetched copy before emitting. */
  export let isOfflineCached = false;
  /** When true, show a tooltip hint indicating this is on a TELA app tab
   *  (dropdown items are still always available). */
  export let isTelaTab = true;

  const dispatch = createEventDispatcher();

  let open = false;
  let rootEl;

  function toggleOpen(event) {
    event.stopPropagation();
    open = !open;
  }

  function closeMenu() {
    open = false;
  }

  function handleReload() {
    if (disabled) return;
    dispatch('reload');
    closeMenu();
  }

  function handleHardReload() {
    if (disabled) return;
    dispatch('hardReload');
    closeMenu();
  }

  function handleEmptyCache() {
    if (disabled) return;
    if (isOfflineCached) {
      const ok = confirm(
        'Empty cache and reload this app?\n\n' +
        'This will clear the browse cache, stored HTML versions, and the ' +
        'dURL name resolution entry for this app.\n\n' +
        '⚠ This app is also saved for offline use. Clearing will remove ' +
        'the offline copy.'
      );
      if (!ok) {
        closeMenu();
        return;
      }
    }
    dispatch('emptyCacheReload');
    closeMenu();
  }

  function handleContextMenu(event) {
    // Right-click anywhere on the split button opens the dropdown,
    // matching Chromium's reload affordance.
    event.preventDefault();
    event.stopPropagation();
    open = true;
  }

  function handleDocumentClick(event) {
    if (!open) return;
    if (rootEl && !rootEl.contains(event.target)) {
      closeMenu();
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      closeMenu();
    }
  }

  // Platform-appropriate shortcut labels
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  const reloadLabel = isMac ? '⌘R' : 'Ctrl+R';
  const hardReloadLabel = isMac ? '⇧⌘R' : 'Ctrl+Shift+R';
</script>

<svelte:window on:click={handleDocumentClick} on:keydown={handleKeydown} />

<div
  class="reload-split"
  class:open
  bind:this={rootEl}
  on:contextmenu={handleContextMenu}
>
  <button
    type="button"
    class="nav-btn reload-main"
    on:click={handleReload}
    {disabled}
    title={isTelaTab ? `Reload (${reloadLabel}) — right-click for more options` : 'Reload'}
  >
    <RotateCcw size={14} />
  </button>

  <button
    type="button"
    class="nav-btn reload-chevron"
    class:active={open}
    on:click={toggleOpen}
    {disabled}
    aria-haspopup="menu"
    aria-expanded={open}
    title="Reload options"
  >
    <ChevronDown size={12} />
  </button>

  {#if open}
    <div class="reload-menu" role="menu">
      <button
        type="button"
        class="reload-menu-item"
        role="menuitem"
        on:click={handleReload}
      >
        <span class="reload-menu-icon"><RotateCcw size={14} /></span>
        <span class="reload-menu-label">Reload</span>
        <span class="reload-menu-kbd">{reloadLabel}</span>
      </button>

      <button
        type="button"
        class="reload-menu-item"
        role="menuitem"
        on:click={handleHardReload}
      >
        <span class="reload-menu-icon"><RefreshCw size={14} /></span>
        <span class="reload-menu-label">Hard Reload</span>
        <span class="reload-menu-kbd">{hardReloadLabel}</span>
      </button>

      <div class="reload-menu-divider" />

      <button
        type="button"
        class="reload-menu-item reload-menu-item-danger"
        role="menuitem"
        on:click={handleEmptyCache}
      >
        <span class="reload-menu-icon"><Trash2 size={14} /></span>
        <span class="reload-menu-label">Empty Cache &amp; Reload</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .reload-split {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  /* Tighten the chevron against the main reload button so the pair reads
     as one control rather than two adjacent nav-btns. */
  .reload-main {
    padding-right: 2px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .reload-chevron {
    width: 16px;
    padding: 0;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    /* Hairline divider between the two halves, visible only on hover of
       either side to stay quiet when idle. */
    position: relative;
  }

  .reload-split:hover .reload-chevron::before,
  .reload-split.open .reload-chevron::before {
    content: '';
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 0;
    width: 1px;
    background: var(--border-subtle, rgba(255, 255, 255, 0.08));
  }

  .reload-chevron.active {
    color: var(--cyan-400);
    background: rgba(34, 211, 238, 0.08);
  }

  /* Dropdown panel — matches HoloCard surface treatment. */
  .reload-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 240px;
    padding: var(--s-1, 4px);
    background: var(--void-mid, #12121c);
    border: 1px solid var(--border-default, rgba(255, 255, 255, 0.09));
    border-radius: var(--r-md, 8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 1000;
  }

  .reload-menu-item {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    width: 100%;
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: transparent;
    border: none;
    border-radius: var(--r-sm, 6px);
    color: var(--text-2, rgba(255, 255, 255, 0.78));
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: all var(--dur-fast, 120ms);
  }

  .reload-menu-item:hover {
    background: var(--void-hover, rgba(255, 255, 255, 0.04));
    color: var(--text-1, #fff);
  }

  .reload-menu-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    color: var(--text-3, rgba(255, 255, 255, 0.55));
  }

  .reload-menu-item:hover .reload-menu-icon {
    color: var(--cyan-400, #22d3ee);
  }

  .reload-menu-label {
    flex: 1;
  }

  .reload-menu-kbd {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--text-4, rgba(255, 255, 255, 0.4));
    letter-spacing: 0.02em;
  }

  .reload-menu-divider {
    height: 1px;
    margin: var(--s-1, 4px) 0;
    background: var(--border-subtle, rgba(255, 255, 255, 0.06));
  }

  .reload-menu-item-danger:hover {
    color: #ff6b9d;
    background: rgba(255, 107, 157, 0.08);
  }

  .reload-menu-item-danger:hover .reload-menu-icon {
    color: #ff6b9d;
  }
</style>
