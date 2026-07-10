<script>
  import { createEventDispatcher } from 'svelte';
  import { GetRatingCategories, GetRatingDetails, BuildRating } from '../../../wailsjs/go/main/App.js';
  import { Icons } from './holo';
  
  export let initialRating = null; // Optional initial rating value (0-99)
  export let compact = false; // Compact mode for inline use
  
  const dispatch = createEventDispatcher();
  
  let categories = [];
  let details = [];
  let selectedCategory = null;
  let selectedDetail = 0;
  let loading = true;
  let finalRating = null;
  
  // Load categories on mount
  async function loadCategories() {
    loading = true;
    try {
      const result = await GetRatingCategories();
      if (result.success) {
        categories = result.categories;
        
        // If initial rating provided, parse it
        if (initialRating !== null && initialRating >= 0 && initialRating <= 99) {
          selectedCategory = Math.floor(initialRating / 10);
          selectedDetail = initialRating % 10;
          await loadDetails(selectedCategory);
        }
      }
    } catch (e) {
      console.error('Failed to load rating categories:', e);
    } finally {
      loading = false;
    }
  }
  
  // Load details when category is selected
  async function loadDetails(category) {
    try {
      const result = await GetRatingDetails(category);
      if (result.success) {
        details = result.details;
      }
    } catch (e) {
      console.error('Failed to load rating details:', e);
    }
  }
  
  // Handle category selection
  async function selectCategory(cat) {
    selectedCategory = cat.value;
    selectedDetail = 0; // Reset detail to "Nothing"
    await loadDetails(cat.value);
    updateRating();
  }
  
  // Handle detail selection
  function selectDetail(det) {
    selectedDetail = det.value;
    updateRating();
  }
  
  // Update and dispatch the final rating
  async function updateRating() {
    if (selectedCategory === null) return;
    
    try {
      const result = await BuildRating(selectedCategory, selectedDetail);
      if (result.success) {
        finalRating = result.parsed;
        dispatch('change', {
          rating: finalRating.ratingValue,
          category: selectedCategory,
          detail: selectedDetail,
          parsed: finalRating
        });
      }
    } catch (e) {
      console.error('Failed to build rating:', e);
    }
  }
  
  // Initialize
  loadCategories();
</script>

<div class="rating-picker" class:compact>
  {#if loading}
    <div class="rating-loading">
      <Icons name="loader" size={20} />
      <span>Loading rating options...</span>
    </div>
  {:else}
    <!-- Category Selection -->
    <div class="rating-section">
      <div class="rating-section-header">
        <span class="rating-section-title">Category</span>
        {#if selectedCategory !== null}
          <span class="rating-badge" style="background: {categories[selectedCategory]?.color};">
            {categories[selectedCategory]?.name}
          </span>
        {/if}
      </div>
      
      <div class="rating-grid categories">
        {#each categories as cat}
          <button
            class="rating-option"
            class:selected={selectedCategory === cat.value}
            class:positive={cat.isPositive}
            class:negative={!cat.isPositive}
            style="--rating-color: {cat.color};"
            on:click={() => selectCategory(cat)}
            title={cat.description}
          >
            <span class="rating-value">{cat.value}</span>
            <span class="rating-label">{cat.name}</span>
          </button>
        {/each}
      </div>
    </div>
    
    <!-- Detail Selection (only shown after category selected) -->
    {#if selectedCategory !== null && details.length > 0}
      <div class="rating-section">
        <div class="rating-section-header">
          <span class="rating-section-title">Detail</span>
          <span class="rating-badge detail">
            {details[selectedDetail]?.name || 'None'}
          </span>
        </div>
        
        <div class="rating-grid details">
          {#each details as det}
            <button
              class="rating-option detail-option"
              class:selected={selectedDetail === det.value}
              on:click={() => selectDetail(det)}
            >
              <span class="rating-value">{det.value}</span>
              <span class="rating-label">{det.name}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
    
    <!-- Final Rating Preview -->
    {#if finalRating}
      <div class="rating-preview">
        <div class="rating-preview-header">Your Rating</div>
        <div class="rating-preview-value" style="color: {finalRating.color};">
          <span class="rating-number">{finalRating.ratingValue}</span>
          <span class="rating-text">{finalRating.displayText}</span>
        </div>
        <div class="rating-preview-note">
          {#if finalRating.isPositive}
            <Icons name="thumbs-up" size={14} />
            <span>Positive rating (Like)</span>
          {:else}
            <Icons name="thumbs-down" size={14} />
            <span>Negative rating (Dislike)</span>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .rating-picker {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    padding: var(--s-4);
    background: var(--void-base);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
  }
  
  .rating-picker.compact {
    padding: var(--s-2);
    gap: var(--s-2);
  }
  
  .rating-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-4);
    color: var(--text-muted);
  }
  
  .rating-section {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  
  .rating-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
  }
  
  .rating-section-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .rating-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    color: var(--void-base);
  }
  
  .rating-badge.detail {
    background: var(--surface-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  
  .rating-grid {
    display: grid;
    gap: var(--s-1);
  }
  
  .rating-grid.categories {
    grid-template-columns: repeat(5, 1fr);
  }
  
  .rating-grid.details {
    grid-template-columns: repeat(5, 1fr);
  }
  
  .rating-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--s-2);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s ease;
    min-width: 0;
  }
  
  .rating-option:hover {
    background: var(--surface-hover);
    border-color: var(--border-default);
  }
  
  .rating-option.selected {
    background: var(--rating-color, var(--cyan-500));
    border-color: var(--rating-color, var(--cyan-500));
    color: white;
  }
  
  .rating-option.selected .rating-label {
    color: white;
  }
  
  .rating-option.negative:not(.selected):hover {
    border-color: var(--status-error);
  }
  
  .rating-option.positive:not(.selected):hover {
    border-color: var(--status-success);
  }
  
  .rating-value {
    font-size: 14px;
    font-weight: 700;
    font-family: var(--font-mono);
  }
  
  .rating-label {
    font-size: 9px;
    color: var(--text-muted);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  
  .detail-option .rating-label {
    font-size: 8px;
  }
  
  .rating-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3);
    background: var(--surface-elevated);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-default);
  }
  
  .rating-preview-header {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  
  .rating-preview-value {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
  }
  
  .rating-number {
    font-size: 32px;
    font-weight: 700;
    font-family: var(--font-mono);
  }
  
  .rating-text {
    font-size: 14px;
    font-weight: 500;
  }
  
  .rating-preview-note {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    font-size: 11px;
    color: var(--text-muted);
  }
  
  /* Compact mode adjustments */
  .compact .rating-grid.categories {
    grid-template-columns: repeat(10, 1fr);
  }
  
  .compact .rating-grid.details {
    grid-template-columns: repeat(10, 1fr);
  }
  
  .compact .rating-option {
    padding: var(--s-1);
  }
  
  .compact .rating-value {
    font-size: 12px;
  }
  
  .compact .rating-label {
    display: none;
  }
  
  .compact .rating-preview {
    flex-direction: row;
    justify-content: center;
  }
  
  .compact .rating-number {
    font-size: 24px;
  }
</style>

