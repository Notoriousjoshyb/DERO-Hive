<script>
  import { onMount, onDestroy } from 'svelte';
  import { GetNetworkHealth, GetMempoolStats } from '../../../wailsjs/go/main/App.js';
  import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime.js';
  
  // Health state
  let health = {
    score: 100,
    status: 'Excellent',
    description: 'All systems healthy',
    statusColor: 'green',
    issues: [],
  };
  
  // Node info for health panel grid
  let nodeNetwork = 'mainnet';
  let syncStatus = 'SYNCED';
  let syncPercent = 100;
  
  // Activity feed
  let activityFeed = [];
  const MAX_ACTIVITY = 10;
  
  // Mempool state
  let mempool = {
    count: 0,
    totalSize: 0,
    totalFees: 0,
    avgFee: 0,
  };
  
  let isLive = true;
  let lastUpdated = null;
  
  // Track previous values for change detection
  let prevHealth = { score: 100 };
  let prevMempool = { count: 0 };
  
  // Reactive relative timestamps - update every second
  let now = Date.now();
  let timestampInterval;
  
  onMount(() => {
    updateHealth();
    updateMempool();
    
    // Update relative timestamps every second
    timestampInterval = setInterval(() => {
      now = Date.now();
    }, 1000);
    
    // Subscribe to new block events
    EventsOn('explorer:newBlock', handleNewBlock);
    
    // Subscribe to status updates from backend (replaces polling)
    EventsOn('status:update', handleStatusUpdate);
  });
  
  onDestroy(() => {
    EventsOff('explorer:newBlock');
    EventsOff('status:update');
    if (timestampInterval) clearInterval(timestampInterval);
  });
  
  function handleStatusUpdate(status) {
    if (!isLive) return;
    
    // Update from status broadcast - mempool info comes through node status
    if (status?.node) {
      const newMempoolCount = status.node.txPoolSize || 0;
      
      // Update node info for health panel grid
      if (status.node.network) {
        nodeNetwork = status.node.network;
      }
      
      // Calculate sync status from chain height vs topo height
      if (status.node.chainHeight && status.node.topoHeight) {
        const chain = status.node.chainHeight;
        const topo = status.node.topoHeight;
        // If heights are close, we're synced
        if (chain > 0 && Math.abs(chain - topo) <= 2) {
          syncStatus = 'SYNCED';
          syncPercent = 100;
        } else if (chain > 0) {
          syncPercent = Math.min(99, Math.floor((topo / chain) * 100));
          syncStatus = `${syncPercent}%`;
        }
      } else if (!status.node.connected) {
        syncStatus = 'OFFLINE';
        syncPercent = 0;
      }
      
      // Check for mempool changes
      if (prevMempool.count !== newMempoolCount) {
        const change = newMempoolCount - prevMempool.count;
        if (change > 0) {
          addActivity('mempool', `${change} new TX${change > 1 ? 's' : ''} in mempool`, 'cyan');
        } else if (change < 0) {
          addActivity('mempool', `${Math.abs(change)} TX${Math.abs(change) > 1 ? 's' : ''} confirmed`, 'green');
        }
      }
      
      prevMempool.count = newMempoolCount;
      mempool = {
        ...mempool,
        count: newMempoolCount,
      };
      lastUpdated = new Date();
    }
  }
  
  function handleNewBlock(data) {
    addActivity('block', `New block #${data.height?.toLocaleString()}`, 'cyan');
    
    // If multiple blocks were mined quickly
    if (data.blockDiff > 1) {
      addActivity('info', `${data.blockDiff} blocks in rapid succession`, 'violet');
    }
  }
  
  async function updateHealth() {
    try {
      const result = await GetNetworkHealth();
      if (result?.success) {
        // Check for health score changes
        if (prevHealth.score !== result.healthScore) {
          const change = result.healthScore - prevHealth.score;
          if (Math.abs(change) >= 5) {
            const direction = change > 0 ? 'improved' : 'declined';
            addActivity('health', `Network health ${direction} (${change > 0 ? '+' : ''}${change})`, change > 0 ? 'green' : 'red');
          }
        }
        
        prevHealth.score = result.healthScore;
        health = {
          score: result.healthScore,
          status: result.status,
          description: result.description,
          statusColor: result.statusColor,
          issues: result.issues || [],
        };
        lastUpdated = new Date();
      }
    } catch (e) {
      console.error('Failed to get network health:', e);
    }
  }
  
  async function updateMempool() {
    try {
      const result = await GetMempoolStats();
      if (result?.success) {
        const stats = result.stats;
        
        // Check for mempool changes
        if (prevMempool.count !== stats.count) {
          const change = stats.count - prevMempool.count;
          if (change > 0) {
            addActivity('mempool', `${change} new TX${change > 1 ? 's' : ''} in mempool`, 'cyan');
          } else if (change < 0) {
            addActivity('mempool', `${Math.abs(change)} TX${Math.abs(change) > 1 ? 's' : ''} confirmed`, 'green');
          }
        }
        
        prevMempool.count = stats.count;
        mempool = {
          count: stats.count,
          totalSize: stats.totalSize,
          totalFees: stats.totalFees,
          avgFee: stats.avgFee,
        };
      }
    } catch (e) {
      console.error('Failed to get mempool stats:', e);
    }
  }
  
  function addActivity(type, message, color = 'gray') {
    const activity = {
      id: Date.now() + Math.random(),
      type,
      message,
      color,
      createdAt: Date.now(), // Store raw timestamp for relative formatting
    };
    
    activityFeed = [activity, ...activityFeed].slice(0, MAX_ACTIVITY);
  }
  
  function toggleLive() {
    isLive = !isLive;
    if (isLive) {
      updateHealth();
      updateMempool();
    }
  }
  
  function getActivityIcon(type) {
    switch (type) {
      case 'block': return '⋖';
      case 'health': return '◉';
      case 'mempool': return '▣';
      case 'peer': return '⬡';
      case 'difficulty': return '◆';
      case 'info': return 'i';
      default: return '○';
    }
  }
  
  // Format relative timestamp like "12s ago", "30s ago", "2m ago"
  function formatRelativeTime(createdAt) {
    const diff = now - createdAt;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    return `${hours}h ago`;
  }
  
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
</script>

<!-- v5.6 Command Center Health + Mempool Row -->
<div class="cmd-health-layout">
  <!-- Health + Mempool Row -->
  <div class="cmd-health-row">
    <!-- Health Score Panel - Grid Layout to Match Network Stats -->
    <div class="cmd-health-panel">
      <div class="cmd-panel-header">
        <div class="cmd-panel-title">
          <span class="cmd-icon">♥</span>
          NETWORK HEALTH
        </div>
        <button 
          class="cmd-live-badge" 
          class:paused={!isLive}
          on:click={toggleLive}
        >
          <span class="cmd-live-dot"></span>
          {isLive ? 'LIVE' : 'PAUSED'}
        </button>
      </div>
      
      <!-- Grid-based health display matching Mempool style -->
      <div class="cmd-health-grid">
        <div class="cmd-health-cell">
          <span 
            class="cmd-health-cell-value"
            class:c-ok={health.statusColor === 'green'} 
            class:c-warn={health.statusColor === 'yellow'} 
            class:c-err={health.statusColor === 'red'}
          >
            {health.score}%
          </span>
          <span class="cmd-health-cell-label">HEALTH SCORE</span>
        </div>
        <div class="cmd-health-cell">
          <span class="cmd-health-cell-value">{nodeNetwork.toUpperCase()}</span>
          <span class="cmd-health-cell-label">NETWORK</span>
        </div>
        <div class="cmd-health-cell">
          <span 
            class="cmd-health-cell-value"
            class:c-ok={syncPercent === 100}
            class:c-warn={syncPercent > 0 && syncPercent < 100}
            class:c-err={syncPercent === 0}
          >
            {syncStatus}
          </span>
          <span class="cmd-health-cell-label">SYNC STATUS</span>
        </div>
      </div>
      
      {#if health.issues.length > 0}
        <div class="cmd-health-issues">
          {#each health.issues as issue}
            <span class="cmd-issue-badge">⚠ {issue}</span>
          {/each}
        </div>
      {/if}
    </div>
    
    <!-- Mempool Panel -->
    <div class="cmd-mempool-panel">
      <div class="cmd-panel-header">
        <span class="cmd-panel-title">
          <span class="cmd-icon">▣</span>
          MEMPOOL
        </span>
      </div>
      
      <div class="cmd-mempool-grid">
        <div class="cmd-mempool-stat">
          <span class="cmd-mempool-value c-cyan">{mempool.count}</span>
          <span class="cmd-mempool-label">PENDING TXS</span>
        </div>
        <div class="cmd-mempool-stat">
          <span class="cmd-mempool-value">{formatSize(mempool.totalSize)}</span>
          <span class="cmd-mempool-label">TOTAL SIZE</span>
        </div>
        <div class="cmd-mempool-stat">
          <span class="cmd-mempool-value c-warn">{mempool.avgFee.toFixed(5)}</span>
          <span class="cmd-mempool-label">AVG FEE (DERO)</span>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Activity Feed Panel - Moodboard Exact Match -->
  <div class="cmd-activity-panel">
    <div class="cmd-panel-header">
      <div class="cmd-panel-title">
        <span class="cmd-icon">◇</span>
        NETWORK ACTIVITY
      </div>
      <span class="cmd-activity-count">{activityFeed.length} events</span>
    </div>
    
    <div class="cmd-activity-body">
      {#if activityFeed.length === 0}
        <div class="cmd-activity-empty">
          <span class="cmd-empty-icon">○</span>
          <p class="cmd-empty-text">Monitoring network activity...</p>
        </div>
      {:else}
        <div class="cmd-activity-list">
          {#each activityFeed as activity (activity.id)}
            <div class="activity-row">
              <span class="activity-dot {activity.color}"></span>
              <span class="activity-icon">{getActivityIcon(activity.type)}</span>
              <span class="activity-message">{activity.message}</span>
              <span class="activity-time">{formatRelativeTime(activity.createdAt)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* 
   * NetworkHealth.svelte - v6.1
   * Global cmd-* styles are in hologram.css
   * Component-specific styles below
   */
  
  /* Component-specific margin for layout */
  .cmd-health-layout {
    margin-top: var(--s-4);
  }
  
  /* Health Grid Display - Component-specific */
  .cmd-health-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--s-3);
    padding: var(--s-4);
    background: var(--void-mid);
  }
  
  .cmd-health-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-md);
  }
  
  .cmd-health-cell-label {
    font-size: 8px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-5);
  }
  
  .cmd-health-cell-value {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 500;
    color: var(--text-1);
  }
  
  .cmd-health-cell-value.c-ok { color: var(--cyan-400); }
  .cmd-health-cell-value.c-warn { color: var(--status-warn); }
  .cmd-health-cell-value.c-err { color: var(--status-err); }
  
  .cmd-health-issues {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    padding: 0 var(--s-4) var(--s-4);
  }
  
  .cmd-issue-badge {
    padding: 2px var(--s-2);
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: var(--r-xs);
    font-size: 10px;
    color: var(--status-warn);
  }
  
  /* Mempool Panel */
  .cmd-mempool-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--s-3);
    padding: var(--s-4);
  }
  
  .cmd-mempool-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-3);
    background: var(--void-deep);
    border-radius: var(--r-md);
  }
  
  .cmd-mempool-value {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 500;
    color: var(--text-1);
  }
  
  .cmd-mempool-value.c-cyan { color: var(--cyan-400); }
  .cmd-mempool-value.c-warn { color: var(--status-warn); }
  
  .cmd-mempool-label {
    font-size: 8px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-5);
  }
  
  /* Activity Panel */
  .cmd-activity-count {
    font-size: 11px;
    color: var(--text-4);
  }
  
  .cmd-activity-body {
    padding: var(--s-3);
    max-height: 200px;
    overflow-y: auto;
  }
  
  .cmd-activity-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--s-6);
    color: var(--text-4);
  }
  
  .cmd-empty-icon {
    font-size: 24px;
    margin-bottom: var(--s-2);
    opacity: 0.5;
  }
  
  .cmd-empty-text {
    font-size: 12px;
    margin: 0;
  }
  
  .cmd-activity-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  
  /* === MOODBOARD EXACT MATCH: Activity Row with Dot Indicator === */
  .activity-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    background: var(--void-deep);
    border-radius: var(--r-lg);
    animation: slide-in 0.3s ease;
  }
  
  /* Colored dot indicator - matches moodboard */
  .activity-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-4);
  }
  
  .activity-dot.cyan { background: var(--cyan-400); }
  .activity-dot.violet { background: var(--violet-400); }
  .activity-dot.green { background: var(--status-ok); }
  .activity-dot.amber { background: var(--status-warn); }
  .activity-dot.red { background: var(--status-err); }
  .activity-dot.primary { background: var(--cyan-400); }
  
  .activity-icon {
    font-size: 14px;
    color: var(--text-3);
    width: 16px;
    text-align: center;
  }
  
  .activity-message {
    flex: 1;
    font-size: 13px;
    color: var(--text-1);
  }
  
  /* Relative timestamp - matches moodboard "12s ago" format */
  .activity-time {
    font-size: 12px;
    color: var(--text-4);
    font-variant-numeric: tabular-nums;
  }
  
  @keyframes slide-in {
    from { opacity: 0; transform: translateX(-10px); }
    to { opacity: 1; transform: translateX(0); }
  }
  
  /* Scrollbar for activity */
  .cmd-activity-body::-webkit-scrollbar {
    width: 4px;
  }
  
  .cmd-activity-body::-webkit-scrollbar-track {
    background: var(--void-deep);
  }
  
  .cmd-activity-body::-webkit-scrollbar-thumb {
    background: var(--void-hover);
    border-radius: var(--r-full);
  }
  
  /* Responsive */
  @media (max-width: 768px) {
    .cmd-health-row {
      grid-template-columns: 1fr;
    }
    
    .cmd-health-grid {
      grid-template-columns: repeat(3, 1fr);
    }
    
    .cmd-mempool-grid {
      grid-template-columns: 1fr 1fr;
    }
  }
  
  @media (max-width: 480px) {
    .cmd-health-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
