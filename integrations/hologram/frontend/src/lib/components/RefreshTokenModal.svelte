<script>
  import { createEventDispatcher } from 'svelte';
  import { RefreshTokenMetadata } from '../../../wailsjs/go/main/App.js';
  import { toast } from '../stores/appState.js';
  import { X, RefreshCw, Loader2, AlertTriangle, ArrowRight } from 'lucide-svelte';

  export let show = false;
  export let token = null; // { scid, name, symbol, icon }

  const dispatch = createEventDispatcher();

  let loading = false;   // preview fetch in flight
  let applying = false;  // commit in flight
  let preview = null;    // { current, fresh, changed, gnomonRunning }
  let overwriteNames = false;
  let fetchError = null;

  // Re-run the preview whenever the modal opens for a token. Because preview
  // resolution depends on overwriteNames (fill-empty vs replace), re-fetch when
  // the user toggles it too.
  $: if (show && token) {
    runPreview(token.scid, overwriteNames);
  }

  let lastKey = '';
  async function runPreview(scid, overwrite) {
    const key = `${scid}:${overwrite}`;
    if (key === lastKey) return; // guard the reactive re-entry
    lastKey = key;
    loading = true;
    fetchError = null;
    preview = null;
    try {
      // apply=false → pure preview, persists nothing.
      const result = await RefreshTokenMetadata(scid, false, overwrite);
      if (result.success) {
        preview = result;
      } else {
        fetchError = result.error || 'Failed to resolve metadata';
      }
    } catch (e) {
      fetchError = e.message || 'Failed to resolve metadata';
    } finally {
      loading = false;
    }
  }

  async function apply() {
    if (!token?.scid || !preview?.changed) return;
    applying = true;
    try {
      const result = await RefreshTokenMetadata(token.scid, true, overwriteNames);
      if (result.success && result.updated) {
        toast.success('Metadata updated');
        dispatch('refreshed', token.scid);
        close();
      } else if (result.success) {
        toast.info('Nothing to update');
        close();
      } else {
        toast.error(result.error || 'Failed to update metadata');
      }
    } catch (e) {
      toast.error('Failed to update metadata');
    } finally {
      applying = false;
    }
  }

  function close() {
    if (applying) return;
    show = false;
    preview = null;
    fetchError = null;
    overwriteNames = false;
    lastKey = '';
    dispatch('close');
  }

  function shouldShowIcon(iconUrl) {
    return iconUrl && /^data:image\//i.test(iconUrl);
  }

  // Per-field rows for the diff table. Icon is shown as a swatch/glyph, others as text.
  const FIELDS = [
    { key: 'name', label: 'Name' },
    { key: 'symbol', label: 'Symbol' },
    { key: 'description', label: 'Description' },
  ];

  function changedField(key) {
    return preview && preview.current[key] !== preview.fresh[key];
  }

  function display(val) {
    return val && val.length ? val : '—';
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show && token}
  <div class="modal-overlay" on:click|self={close}>
    <div class="modal-content">
      <div class="modal-header">
        <div class="modal-title">
          <RefreshCw size={18} />
          <span>Refresh Metadata</span>
        </div>
        <button class="modal-close" on:click={close}>
          <X size={18} />
        </button>
      </div>

      <div class="modal-body">
        {#if loading}
          <div class="resolving">
            <Loader2 size={18} class="spin" />
            <span>Resolving on-chain headers…</span>
          </div>
        {:else if fetchError}
          <div class="alert alert-error">
            <AlertTriangle size={14} />
            <span>{fetchError}</span>
          </div>
        {:else if preview}
          {#if preview.gnomonRunning === false}
            <div class="alert alert-warning">
              <AlertTriangle size={14} />
              <span>Gnomon isn't running — nothing new can be resolved. Start it in Settings, then refresh.</span>
            </div>
          {/if}

          <table class="diff">
            <thead>
              <tr>
                <th></th>
                <th>Current</th>
                <th></th>
                <th>On-chain</th>
              </tr>
            </thead>
            <tbody>
              {#each FIELDS as f}
                <tr class:row-changed={changedField(f.key)}>
                  <td class="diff-label">{f.label}</td>
                  <td class="diff-current">{display(preview.current[f.key])}</td>
                  <td class="diff-arrow">{#if changedField(f.key)}<ArrowRight size={11} />{/if}</td>
                  <td class="diff-fresh" class:changed={changedField(f.key)}>{display(preview.fresh[f.key])}</td>
                </tr>
              {/each}
              <tr class:row-changed={preview.current.icon !== preview.fresh.icon}>
                <td class="diff-label">Icon</td>
                <td class="diff-current">
                  {#if shouldShowIcon(preview.current.icon)}<img class="swatch" src={preview.current.icon} alt="" />{:else}⬡{/if}
                </td>
                <td class="diff-arrow">{#if preview.current.icon !== preview.fresh.icon}<ArrowRight size={11} />{/if}</td>
                <td class="diff-fresh">
                  {#if shouldShowIcon(preview.fresh.icon)}<img class="swatch" src={preview.fresh.icon} alt="" />{:else}<span class="muted">⬡ remote blocked</span>{/if}
                </td>
              </tr>
            </tbody>
          </table>

          {#if !preview.changed}
            <p class="up-to-date">Already up to date — no changes to apply.</p>
          {/if}

          <label class="overwrite-row">
            <input type="checkbox" bind:checked={overwriteNames} />
            <span>Replace my custom name/symbol with on-chain values</span>
          </label>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" on:click={close} disabled={applying}>Cancel</button>
        <button class="btn btn-primary" on:click={apply} disabled={loading || applying || !preview?.changed}>
          {#if applying}
            <Loader2 size={14} class="spin" />
            Applying…
          {:else}
            Apply
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .resolving {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-6) 0;
    color: var(--text-3);
    font-size: 13px;
  }

  .diff {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .diff th {
    text-align: left;
    color: var(--text-4);
    font-weight: 400;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: var(--s-1) var(--s-2);
  }

  .diff td {
    padding: var(--s-2);
    border-top: 1px solid var(--border-dim);
    vertical-align: top;
  }

  .diff-label {
    color: var(--text-4);
    white-space: nowrap;
  }

  .diff-current {
    color: var(--text-3);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .diff-arrow {
    color: var(--text-4);
    width: 16px;
    text-align: center;
  }

  .diff-fresh {
    color: var(--text-2);
    max-width: 160px;
  }

  .diff-fresh.changed {
    color: var(--cyan-400);
  }

  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
    vertical-align: middle;
  }

  .muted {
    color: var(--text-4);
    font-size: 11px;
  }

  .up-to-date {
    font-size: 12px;
    color: var(--text-4);
    text-align: center;
    margin: var(--s-3) 0 0;
  }

  .overwrite-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-top: var(--s-4);
    font-size: 12px;
    color: var(--text-3);
    cursor: pointer;
  }

  .overwrite-row input {
    cursor: pointer;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
