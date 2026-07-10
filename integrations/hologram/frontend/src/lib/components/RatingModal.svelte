<script>
  import { createEventDispatcher } from 'svelte';
  import { X, Star, Loader2, CheckCircle, AlertTriangle } from 'lucide-svelte';
  import RatingPicker from './RatingPicker.svelte';
  import { SubmitRatingWithPicker } from '../../../wailsjs/go/main/App.js';
  
  export let show = false;
  export let scid = '';
  export let appName = '';
  
  const dispatch = createEventDispatcher();
  
  let selectedRating = null;
  let submitting = false;
  let submitError = '';
  let submitSuccess = false;
  
  function handleRatingChange(event) {
    selectedRating = event.detail;
  }
  
  async function submitRating() {
    if (!selectedRating || !scid) return;
    
    submitting = true;
    submitError = '';
    
    try {
      const result = await SubmitRatingWithPicker(scid, selectedRating.category, selectedRating.detail);
      
      if (result.success) {
        submitSuccess = true;
        dispatch('rated', {
          scid,
          rating: selectedRating.rating,
          parsed: selectedRating.parsed
        });
        
        // Auto-close after success
        setTimeout(() => {
          close();
        }, 2000);
      } else {
        submitError = result.error || 'Failed to submit rating';
      }
    } catch (e) {
      submitError = e.message || 'Failed to submit rating';
    } finally {
      submitting = false;
    }
  }
  
  function close() {
    show = false;
    selectedRating = null;
    submitError = '';
    submitSuccess = false;
    dispatch('close');
  }
  
  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) {
      close();
    }
  }
  
  function handleKeydown(event) {
    if (event.key === 'Escape') {
      close();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
  <div class="rating-modal-backdrop" on:click={handleBackdropClick}>
    <div class="rating-modal">
      <!-- Header -->
      <div class="rating-modal-header">
        <div class="rating-modal-title">
          <Star size={20} />
          <span>Rate Content</span>
        </div>
        <button class="rating-modal-close" on:click={close}>
          <X size={18} />
        </button>
      </div>
      
      <!-- App Info -->
      <div class="rating-modal-app-info">
        <span class="rating-app-name">{appName || 'TELA App'}</span>
        <code class="rating-app-scid">{scid?.slice(0, 8)}...{scid?.slice(-8)}</code>
      </div>
      
      <!-- Content -->
      <div class="rating-modal-content">
        {#if submitSuccess}
          <div class="rating-success">
            <CheckCircle size={48} />
            <h3>Rating Submitted!</h3>
            <p>Your rating of <strong>{selectedRating?.rating}</strong> has been recorded.</p>
          </div>
        {:else}
          {#if submitError}
            <div class="rating-error">
              <AlertTriangle size={16} />
              <span>{submitError}</span>
            </div>
          {/if}
          
          <RatingPicker on:change={handleRatingChange} />
        {/if}
      </div>
      
      <!-- Footer -->
      {#if !submitSuccess}
        <div class="rating-modal-footer">
          <button class="btn btn-ghost" on:click={close}>
            Cancel
          </button>
          <button 
            class="btn btn-primary"
            disabled={!selectedRating || submitting}
            on:click={submitRating}
          >
            {#if submitting}
              <span class="spin"><Loader2 size={16} /></span>
              Submitting...
            {:else}
              <Star size={16} />
              Submit Rating
            {/if}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .rating-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: var(--s-4);
  }
  
  .rating-modal {
    background: var(--void-mid);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 500px;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  }
  
  .rating-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-4);
    border-bottom: 1px solid var(--border-dim);
    background: var(--void-up);
  }
  
  .rating-modal-title {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-weight: 600;
    color: var(--cyan-400);
  }
  
  .rating-modal-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .rating-modal-close:hover {
    background: var(--void-surface);
    color: var(--text-primary);
  }
  
  .rating-modal-app-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-4);
    background: var(--void-base);
    border-bottom: 1px solid var(--border-dim);
  }
  
  .rating-app-name {
    font-weight: 500;
    color: var(--text-primary);
  }
  
  .rating-app-scid {
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--void-up);
    padding: var(--s-1) var(--s-2);
    border-radius: var(--radius-sm);
  }
  
  .rating-modal-content {
    padding: var(--s-4);
    overflow-y: auto;
    flex: 1;
  }
  
  .rating-error {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3);
    margin-bottom: var(--s-4);
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: var(--radius-md);
    color: var(--status-err);
    font-size: var(--text-sm);
  }
  
  .rating-success {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--s-8);
    text-align: center;
    color: var(--status-ok);
  }
  
  .rating-success h3 {
    margin-top: var(--s-4);
    color: var(--text-primary);
  }
  
  .rating-success p {
    color: var(--text-secondary);
    margin-top: var(--s-2);
  }
  
  .rating-modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s-3);
    padding: var(--s-4);
    border-top: 1px solid var(--border-dim);
    background: var(--void-up);
  }
  
  .spin {
    display: inline-flex;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>

