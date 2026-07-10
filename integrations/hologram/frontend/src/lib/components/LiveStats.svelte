<script>
  import { onMount, onDestroy } from 'svelte';
  import { appState } from '../stores/appState.js';
  import { GetLiveStats } from '../../../wailsjs/go/main/App.js';
  import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime.js';
  import { Zap } from 'lucide-svelte';
  
  // Local state for live stats
  let stats = {
    height: 0,
    topoheight: 0,
    difficulty: 0,
    hashrate: 0,
    peers: 0,
    txPoolSize: 0,
    uptime: 0,
    version: '',
    network: 'mainnet',
    averageBlockTime: 18,
  };
  
  let lastHeight = 0;
  let newBlockAlert = false;
  let isLive = true;
  let lastUpdated = null;
  let connectionError = false;
  
  // Block delta tracking (blocks in last minute)
  let blockDelta = 0;
  let blockHistory = [];
  const DELTA_WINDOW = 60000; // 1 minute
  
  // Stat change tracking for animations
  let changes = {
    height: false,
    difficulty: false,
    hashrate: false,
    peers: false,
    txPoolSize: false,
  };
  
  onMount(() => {
    // Initial fetch
    updateStats();
    
    // Listen for status updates from backend (replaces polling)
    EventsOn("status:update", handleStatusUpdate);
  });
  
  onDestroy(() => {
    EventsOff("status:update");
  });
  
  function handleStatusUpdate(status) {
    if (!isLive || !status?.node) return;
    
    const newStats = {
      height: status.node.chainHeight || 0,
      topoheight: status.node.topoHeight || 0,
      difficulty: status.node.difficulty || 0,
      hashrate: status.node.hashrate || 0,
      peers: status.node.peerCount || 0,
      txPoolSize: status.node.txPoolSize || 0,
      version: status.node.version || '',
      network: status.node.network || 'mainnet',
    };
    
    // Detect changes for animations
    if (stats.height > 0) {
      changes.height = newStats.height !== stats.height;
      changes.difficulty = Math.abs(newStats.difficulty - stats.difficulty) > stats.difficulty * 0.01;
      changes.hashrate = Math.abs(newStats.hashrate - stats.hashrate) > stats.hashrate * 0.05;
      changes.peers = newStats.peers !== stats.peers;
      changes.txPoolSize = newStats.txPoolSize !== stats.txPoolSize;
      
      // New block detection + delta tracking
      if (newStats.height > lastHeight && lastHeight > 0) {
        newBlockAlert = true;
        setTimeout(() => newBlockAlert = false, 3000);
        
        // Track block for delta calculation
        const now = Date.now();
        blockHistory = [...blockHistory.filter(t => now - t < DELTA_WINDOW), now];
        blockDelta = blockHistory.length;
      }
    }
    
    lastHeight = newStats.height;
    stats = { ...stats, ...newStats };
    lastUpdated = new Date();
    connectionError = !status.node.connected;
    
    // Clear change animations after a moment
    setTimeout(() => {
      changes = { height: false, difficulty: false, hashrate: false, peers: false, txPoolSize: false };
    }, 1000);
  }
  
  async function updateStats() {
    try {
      const result = await GetLiveStats();
      if (result?.success) {
        const newStats = result.stats;
        
        // Detect changes for animations
        if (stats.height > 0) {
          changes.height = newStats.height !== stats.height;
          changes.difficulty = Math.abs(newStats.difficulty - stats.difficulty) > stats.difficulty * 0.01;
          changes.hashrate = Math.abs(newStats.hashrate - stats.hashrate) > stats.hashrate * 0.05;
          changes.peers = newStats.peers !== stats.peers;
          changes.txPoolSize = newStats.txPoolSize !== stats.txPoolSize;
          
          // New block detection + delta tracking
          if (newStats.height > lastHeight && lastHeight > 0) {
            newBlockAlert = true;
            setTimeout(() => newBlockAlert = false, 3000);
            
            const now = Date.now();
            blockHistory = [...blockHistory.filter(t => now - t < DELTA_WINDOW), now];
            blockDelta = blockHistory.length;
          }
        }
        
        lastHeight = newStats.height;
        stats = newStats;
        lastUpdated = new Date();
        connectionError = false;
        
        // Clear change animations after a moment
        setTimeout(() => {
          changes = { height: false, difficulty: false, hashrate: false, peers: false, txPoolSize: false };
        }, 1000);
      }
    } catch (e) {
      console.error('Failed to get live stats:', e);
      connectionError = true;
    }
  }
  
  function toggleLive() {
    isLive = !isLive;
    if (isLive) updateStats();
  }
  
  // Formatting functions
  function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
  }
  
  function formatDifficulty(diff) {
    if (!diff) return '0';
    if (diff >= 1e12) return (diff / 1e12).toFixed(2) + 'T';
    if (diff >= 1e9) return (diff / 1e9).toFixed(2) + 'G';
    if (diff >= 1e6) return (diff / 1e6).toFixed(2) + 'M';
    if (diff >= 1e3) return (diff / 1e3).toFixed(2) + 'K';
    return diff.toLocaleString();
  }
  
  function formatHashrate(hr) {
    if (!hr) return '0 H/s';
    if (hr >= 1e12) return (hr / 1e12).toFixed(2) + ' TH/s';
    if (hr >= 1e9) return (hr / 1e9).toFixed(2) + ' GH/s';
    if (hr >= 1e6) return (hr / 1e6).toFixed(2) + ' MH/s';
    if (hr >= 1e3) return (hr / 1e3).toFixed(2) + ' KH/s';
    return hr.toFixed(0) + ' H/s';
  }
  
  function formatUptime(seconds) {
    if (!seconds) return '—';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
  
  function formatLastUpdated(date) {
    if (!date) return '—';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
</script>

<!-- v5.7 Unified Stats Panel - Equal 3x2 Grid with Internal Dividers -->
<div class="cmd-stats-panel">
  <!-- Panel Header - Style A -->
  <div class="cmd-panel-header">
    <div class="cmd-panel-title">
      <span class="cmd-panel-icon">◎</span>
      NETWORK STATS
    </div>
    <div class="cmd-panel-meta">
      {#if newBlockAlert}
        <span class="cmd-new-block-badge-compact">
          <span class="cmd-new-block-icon">⛏</span>
          <span>#{formatNumber(stats.height)}</span>
        </span>
      {/if}
      <span class="cmd-timestamp-compact" class:error={connectionError}>
        {connectionError ? '⚠ Error' : formatLastUpdated(lastUpdated)}
      </span>
      <button 
        class="cmd-live-badge-compact" 
        class:paused={!isLive}
        on:click={toggleLive}
      >
        <span class="cmd-live-dot"></span>
        <span>{isLive ? 'LIVE' : 'PAUSED'}</span>
      </button>
    </div>
  </div>
  
  <!-- Unified 3x2 Grid with Internal Dividers -->
  <div class="cmd-stats-unified">
    <!-- Row 1 -->
    <div class="cmd-stat-cell" class:changed={changes.height}>
      <div class="cmd-stat-icon">◎</div>
      <div class="cmd-stat-value">{formatNumber(stats.height)}</div>
      <div class="cmd-stat-label">BLOCK HEIGHT</div>
      {#if blockDelta > 0}
        <div class="cmd-stat-delta">▲ +{blockDelta}/min</div>
      {/if}
    </div>
    
    <div class="cmd-stat-cell" class:changed={changes.hashrate}>
      <div class="cmd-stat-icon"><Zap size={14} strokeWidth={1.5} /></div>
      <div class="cmd-stat-value">{formatHashrate(stats.hashrate)}</div>
      <div class="cmd-stat-label">HASHRATE</div>
    </div>
    
    <div class="cmd-stat-cell" class:changed={changes.difficulty}>
      <div class="cmd-stat-icon">◆</div>
      <div class="cmd-stat-value">{formatDifficulty(stats.difficulty)}</div>
      <div class="cmd-stat-label">DIFFICULTY</div>
    </div>
    
    <!-- Row 2 -->
    <div class="cmd-stat-cell" class:changed={changes.peers}>
      <div class="cmd-stat-icon">⬡</div>
      <div class="cmd-stat-value">{stats.peers}</div>
      <div class="cmd-stat-label">PEERS</div>
    </div>
    
    <div class="cmd-stat-cell" class:changed={changes.txPoolSize}>
      <div class="cmd-stat-icon">▣</div>
      <div class="cmd-stat-value">{stats.txPoolSize}</div>
      <div class="cmd-stat-label">TX POOL</div>
    </div>
    
    <div class="cmd-stat-cell">
      <div class="cmd-stat-icon">◇</div>
      <div class="cmd-stat-value">{formatUptime(stats.uptime)}</div>
      <div class="cmd-stat-label">NODE UPTIME</div>
    </div>
  </div>
</div>

<style>
  /* 
   * LiveStats.svelte - v6.1
   * All cmd-* styles are now centralized in hologram.css
   * No component-specific overrides needed
   */
</style>
