<script>
  import { createEventDispatcher } from 'svelte';
  import { RemoveTrackedToken } from '../../../wailsjs/go/main/App.js';
  import { toast } from '../stores/appState.js';
  import { X, Trash2, AlertTriangle, Copy } from 'lucide-svelte';

  export let show = false;
  export let token = null; // { scid, name, symbol, icon }

  const dispatch = createEventDispatcher();

  let loading = false;

  function close() {
    if (loading) return;
    show = false;
    dispatch('close');
  }

  $: displayName = token?.name || token?.symbol || 'Unknown Token';

  function shouldShowIcon(iconUrl) {
    return iconUrl && /^data:image\//i.test(iconUrl);
  }

  function copySCID() {
    if (token?.scid) {
      navigator.clipboard.writeText(token.scid);
      toast.success('Copied!');
    }
  }

  async function confirmRemove() {
    if (!token?.scid) return;
    loading = true;
    try {
      const result = await RemoveTrackedToken(token.scid);
      if (result.success) {
        toast.success('Token removed from portfolio');
        dispatch('removed', token.scid);
        show = false;
        dispatch('close');
      } else {
        toast.error(result.error || 'Failed to remove token');
      }
    } catch (e) {
      toast.error('Failed to remove token');
    } finally {
      loading = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show && token}
  <div class="modal-overlay" on:click|self={close}>
    <div class="modal-content modal-content-narrow">
      <div class="modal-header">
        <div class="modal-title">
          <Trash2 size={18} />
          <span>Remove Token</span>
        </div>
        <button class="modal-close" on:click={close}>
          <X size={18} />
        </button>
      </div>

      <div class="modal-body">
        <div class="token-identity">
          <div class="identity-icon">
            {#if shouldShowIcon(token.icon)}
              <img src={token.icon} alt={displayName} />
            {:else}
              <span class="default-icon">⬡</span>
            {/if}
          </div>
          <div class="identity-text">
            <div class="identity-name">{displayName}</div>
            <button class="identity-scid" on:click={copySCID} title="Copy SCID">
              <span>{token.scid.slice(0, 16)}…{token.scid.slice(-8)}</span>
              <Copy size={11} />
            </button>
          </div>
        </div>

        <div class="alert alert-warning">
          <AlertTriangle size={14} />
          <span>Removal only un-tracks this token — your on-chain balance is untouched. Keep the SCID: re-adding requires it.</span>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" on:click={close} disabled={loading}>Cancel</button>
        <button class="btn btn-danger" on:click={confirmRemove} disabled={loading}>
          {#if loading}Removing…{:else}Remove{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .token-identity {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin-bottom: var(--s-4);
  }

  .identity-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--void-deep);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }

  .identity-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .default-icon {
    font-size: 18px;
    color: var(--text-4);
  }

  .identity-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-1);
  }

  .identity-scid {
    display: flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    padding: 2px 0 0;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-4);
    cursor: pointer;
  }

  .identity-scid:hover {
    color: var(--cyan-400);
  }
</style>
