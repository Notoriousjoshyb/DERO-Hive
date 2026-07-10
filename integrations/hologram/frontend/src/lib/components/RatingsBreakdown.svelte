<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { GetRatingsBreakdown } from '../../../wailsjs/go/main/App.js';
  import { toast } from '../stores/appState.js';
  
  const dispatch = createEventDispatcher();
  
  export let scid = '';
  export let visible = false;
  
  let loading = false;
  let breakdown = null;
  
  $: if (scid && visible) {
    loadBreakdown();
  }
  
  async function loadBreakdown() {
    if (!scid) return;
    
    loading = true;
    try {
      const result = await GetRatingsBreakdown(scid);
      if (result.success) {
        breakdown = result;
      } else {
        toast.error(result.error || 'Failed to load ratings');
      }
    } catch (e) {
      toast.error(e.message || 'Failed to load ratings');
    } finally {
      loading = false;
    }
  }
  
  function close() {
    visible = false;
    dispatch('close');
  }
  
  function truncateSCID(s) {
    if (!s || s.length < 20) return s;
    return s.substring(0, 12) + '...' + s.substring(s.length - 12);
  }
  
  function getCategoryBarWidth(count, total) {
    if (!total || total === 0) return 0;
    return (count / total) * 100;
  }
</script>

{#if visible}
  <div class="ratings-backdrop" on:click={close}>
    <div class="ratings-modal" on:click|stopPropagation>
      <!-- Header -->
      <div class="ratings-header">
        <div class="ratings-header-left">
          <span class="ratings-header-icon">★</span>
          <div class="ratings-header-text">
            <h2 class="ratings-title">Ratings Breakdown</h2>
            <span class="ratings-scid" title={scid}>{truncateSCID(scid)}</span>
          </div>
        </div>
        <button on:click={close} class="ratings-close-btn">✕</button>
      </div>
      
      {#if loading}
        <div class="loading-state">
          <div class="loader"></div>
          <span>Loading ratings...</span>
        </div>
      {:else if breakdown}
        <!-- Summary Stats -->
        <div class="stats-grid">
          <div class="stat-card primary">
            <span class="stat-value">{breakdown.averageDisplay}</span>
            <span class="stat-label">Average Rating</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{breakdown.totalRatings}</span>
            <span class="stat-label">Total Ratings</span>
          </div>
          <div class="stat-card positive">
            <span class="stat-value">{breakdown.likes}</span>
            <span class="stat-label">Likes</span>
          </div>
          <div class="stat-card negative">
            <span class="stat-value">{breakdown.dislikes}</span>
            <span class="stat-label">Dislikes</span>
          </div>
        </div>
        
        <!-- Sentiment Bar -->
        {#if breakdown.totalRatings > 0}
          <div class="sentiment-section">
            <div class="sentiment-header">
              <span class="sentiment-label positive">Positive ({breakdown.positiveCount})</span>
              <span class="sentiment-label negative">Negative ({breakdown.negativeCount})</span>
            </div>
            <div class="sentiment-bar">
              <div 
                class="sentiment-fill positive" 
                style="width: {breakdown.positivePercent}%"
              ></div>
              <div 
                class="sentiment-fill negative" 
                style="width: {breakdown.negativePercent}%"
              ></div>
            </div>
          </div>
        {/if}
        
        <!-- Category Distribution -->
        <div class="category-section">
          <h3 class="section-title">Category Distribution</h3>
          <div class="category-bars">
            {#each breakdown.categoryDist as cat}
              <div class="category-row">
                <div class="category-info">
                  <span class="category-num" style="color: {cat.color}">{cat.category}</span>
                  <span class="category-name">{cat.name}</span>
                </div>
                <div class="category-bar-container">
                  <div 
                    class="category-bar-fill" 
                    style="width: {getCategoryBarWidth(cat.count, breakdown.totalRatings)}%; background: {cat.color}"
                  ></div>
                </div>
                <span class="category-count">{cat.count}</span>
              </div>
            {/each}
          </div>
        </div>
        
        <!-- Individual Ratings -->
        {#if breakdown.ratings && breakdown.ratings.length > 0}
          <div class="ratings-section">
            <h3 class="section-title">Individual Ratings ({breakdown.ratings.length})</h3>
            <div class="ratings-list">
              {#each breakdown.ratings as rating}
                <div class="rating-item">
                  <div class="rating-left">
                    <div class="rating-badge" style="background: {rating.color}">
                      {rating.rating}
                    </div>
                    <div class="rating-text">
                      <span class="rating-category">{rating.categoryName}</span>
                      {#if rating.detailName !== 'Nothing'}
                        <span class="rating-detail">({rating.detailName})</span>
                      {/if}
                    </div>
                  </div>
                  <div class="rating-right">
                    <span class="rating-address" title={rating.fullAddress}>{rating.address}</span>
                    <span class="rating-height">Block #{rating.height}</span>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <div class="no-ratings">
            <span class="no-ratings-icon">☆</span>
            <p class="no-ratings-text">No individual ratings yet</p>
            <p class="no-ratings-hint">Be the first to rate this content</p>
          </div>
        {/if}
      {:else}
        <div class="no-ratings">
          <span class="no-ratings-icon">★</span>
          <p class="no-ratings-text">No ratings data available</p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* === HOLOGRAM v6.1 Ratings Breakdown === */
  
  .ratings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--s-4, 16px);
  }
  
  .ratings-modal {
    background: var(--void-mid, #12121c);
    border: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    border-radius: var(--r-xl, 16px);
    width: 100%;
    max-width: 700px;
    max-height: 90vh;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
  }
  
  /* Header */
  .ratings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-4, 16px);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
    background: var(--void-deep, #08080e);
    flex-shrink: 0;
  }
  
  .ratings-header-left {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
  }
  
  .ratings-header-icon {
    font-size: 28px;
    color: var(--amber-400, #fbbf24);
  }
  
  .ratings-header-text {
    display: flex;
    flex-direction: column;
    gap: var(--s-1, 4px);
  }
  
  .ratings-title {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 700;
    color: var(--text-1, #f8f8fc);
    margin: 0;
  }
  
  .ratings-scid {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-4, #505068);
  }
  
  .ratings-close-btn {
    font-size: 20px;
    padding: var(--s-2, 8px);
    color: var(--text-4, #505068);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 200ms ease-out;
  }
  
  .ratings-close-btn:hover {
    color: var(--text-1, #f8f8fc);
  }
  
  /* Loading */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--s-12, 48px);
    gap: var(--s-4, 16px);
    color: var(--text-4, #505068);
  }
  
  .loader {
    width: 32px;
    height: 32px;
    border: 3px solid var(--void-up, #181824);
    border-top-color: var(--cyan-400, #22d3ee);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Stats Grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--s-3, 12px);
    padding: var(--s-4, 16px);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
  }
  
  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border-radius: var(--r-lg, 12px);
    text-align: center;
  }
  
  .stat-card.primary {
    background: linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(34, 211, 238, 0.05));
    border: 1px solid rgba(6, 182, 212, 0.2);
  }
  
  .stat-card.positive {
    border-left: 3px solid var(--status-ok, #34d399);
  }
  
  .stat-card.negative {
    border-left: 3px solid var(--status-err, #f87171);
  }
  
  .stat-value {
    font-size: 24px;
    font-weight: 700;
    color: var(--text-1, #f8f8fc);
    font-family: var(--font-mono);
  }
  
  .stat-label {
    font-size: 11px;
    color: var(--text-4, #505068);
    margin-top: var(--s-1, 4px);
  }
  
  /* Sentiment */
  .sentiment-section {
    padding: var(--s-4, 16px);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
  }
  
  .sentiment-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: var(--s-2, 8px);
  }
  
  .sentiment-label {
    font-size: 12px;
    font-weight: 500;
  }
  
  .sentiment-label.positive {
    color: var(--status-ok, #34d399);
  }
  
  .sentiment-label.negative {
    color: var(--status-err, #f87171);
  }
  
  .sentiment-bar {
    display: flex;
    height: 8px;
    background: var(--void-deep, #08080e);
    border-radius: 4px;
    overflow: hidden;
  }
  
  .sentiment-fill {
    transition: width 300ms ease-out;
  }
  
  .sentiment-fill.positive {
    background: var(--status-ok, #34d399);
  }
  
  .sentiment-fill.negative {
    background: var(--status-err, #f87171);
  }
  
  /* Category Distribution */
  .category-section {
    padding: var(--s-4, 16px);
    border-bottom: 1px solid var(--border-dim, rgba(255, 255, 255, 0.03));
  }
  
  .section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-2, #a8a8b8);
    margin: 0 0 var(--s-3, 12px) 0;
  }
  
  .category-bars {
    display: flex;
    flex-direction: column;
    gap: var(--s-2, 8px);
  }
  
  .category-row {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
  }
  
  .category-info {
    display: flex;
    align-items: center;
    gap: var(--s-2, 8px);
    min-width: 140px;
  }
  
  .category-num {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 700;
    width: 20px;
  }
  
  .category-name {
    font-size: 12px;
    color: var(--text-3, #707088);
  }
  
  .category-bar-container {
    flex: 1;
    height: 6px;
    background: var(--void-deep, #08080e);
    border-radius: 3px;
    overflow: hidden;
  }
  
  .category-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 300ms ease-out;
  }
  
  .category-count {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-4, #505068);
    min-width: 24px;
    text-align: right;
  }
  
  /* Ratings List */
  .ratings-section {
    padding: var(--s-4, 16px);
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  
  .ratings-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2, 8px);
    overflow-y: auto;
    max-height: 200px;
  }
  
  .rating-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-2, 8px) var(--s-3, 12px);
    background: var(--void-deep, #08080e);
    border-radius: var(--r-md, 8px);
  }
  
  .rating-left {
    display: flex;
    align-items: center;
    gap: var(--s-3, 12px);
  }
  
  .rating-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-md, 8px);
    font-size: 14px;
    font-weight: 700;
    color: var(--void-pure, #000);
  }
  
  .rating-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .rating-category {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2, #a8a8b8);
  }
  
  .rating-detail {
    font-size: 11px;
    color: var(--text-4, #505068);
  }
  
  .rating-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  
  .rating-address {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-4, #505068);
  }
  
  .rating-height {
    font-size: 10px;
    color: var(--text-5, #404058);
  }
  
  /* No Ratings */
  .no-ratings {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--s-8, 32px);
    text-align: center;
  }
  
  .no-ratings-icon {
    font-size: 48px;
    color: var(--text-5, #404058);
    margin-bottom: var(--s-3, 12px);
  }
  
  .no-ratings-text {
    font-size: 16px;
    color: var(--text-3, #707088);
    margin: 0 0 var(--s-1, 4px) 0;
  }
  
  .no-ratings-hint {
    font-size: 13px;
    color: var(--text-5, #404058);
    margin: 0;
  }
  
  /* Responsive */
  @media (max-width: 640px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    
    .category-info {
      min-width: 100px;
    }
  }
</style>

