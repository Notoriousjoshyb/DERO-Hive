<script>
  import { createEventDispatcher } from 'svelte';
  import AddressDisplay from './AddressDisplay.svelte';
  import { Link, Lock, Copy, Pickaxe, ArrowRightLeft, FileCode, Flame, Info } from 'lucide-svelte';
  
  export let ringMembers = [];
  export let ringSize = 0;
  export let txType = 'NORMAL';
  export let isCoinbase = false;
  export let minerAddress = null;
  export let compact = false;
  
  const dispatch = createEventDispatcher();
  
  let hoveredIndex = null;
  let selectedIndex = null;
  let showFullList = false;
  
  // Calculate ring size
  $: actualRingSize = ringMembers?.length || ringSize || 0;
  $: displayMembers = ringMembers?.slice(0, 16) || []; // Show max 16 in circle
  
  // Colors for ring members
  const memberColors = [
    '#b959b6', '#52c8db', '#4ade80', '#fbbf24', 
    '#a855f7', '#f472b6', '#22d3d8', '#84cc16',
    '#fb923c', '#8b5cf6', '#ec4899', '#14b8a6',
    '#f97316', '#6366f1', '#d946ef', '#10b981'
  ];
  
  function getColor(index) {
    return memberColors[index % memberColors.length];
  }
  
  function formatAddress(addr, len = 12) {
    if (!addr) return '—';
    if (addr.length <= len * 2) return addr;
    return addr.slice(0, len) + '...' + addr.slice(-len);
  }
  
  function copyAddress(addr) {
    navigator.clipboard.writeText(addr);
    dispatch('copy', { address: addr });
  }
  
  function handleMemberClick(member, index) {
    selectedIndex = selectedIndex === index ? null : index;
    dispatch('select', { member, index });
  }
  
  // Calculate position on circle for each member
  function getPosition(index, total) {
    const angle = (index / total) * 2 * Math.PI - Math.PI / 2; // Start from top
    const radius = compact ? 60 : 85;
    return {
      x: 100 + radius * Math.cos(angle),
      y: 100 + radius * Math.sin(angle),
    };
  }
  
  // TX Type display config - using Lucide icons (NO EMOJIS per Design System v7.0)
  const txTypeConfig = {
    'COINBASE': { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', icon: 'pickaxe', label: 'Coinbase' },
    'NORMAL': { color: '#52c8db', bg: 'rgba(82,200,219,0.15)', icon: 'transfer', label: 'Normal' },
    'SC': { color: '#a855f7', bg: 'rgba(168,85,247,0.15)', icon: 'code', label: 'Smart Contract' },
    'BURN': { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', icon: 'flame', label: 'Burn' },
    'REGISTRATION': { color: '#4ade80', bg: 'rgba(74,222,128,0.15)', icon: 'R', label: 'Registration' },
    'PREMINE': { color: '#f97316', bg: 'rgba(249,115,22,0.15)', icon: 'P', label: 'Premine' },
  };
  
  $: typeInfo = txTypeConfig[txType] || txTypeConfig['NORMAL'];
</script>

<div class="ring-visualization" class:compact>
  <!-- Header with TX Type -->
  <div class="ring-header">
    <div class="tx-type-badge" style="--badge-color: {typeInfo.color}; --badge-bg: {typeInfo.bg}">
      <span class="type-icon">
        {#if typeInfo.icon === 'pickaxe'}
          <Pickaxe size={14} strokeWidth={1.5} />
        {:else if typeInfo.icon === 'transfer'}
          <ArrowRightLeft size={14} strokeWidth={1.5} />
        {:else if typeInfo.icon === 'code'}
          <FileCode size={14} strokeWidth={1.5} />
        {:else if typeInfo.icon === 'flame'}
          <Flame size={14} strokeWidth={1.5} />
        {:else}
          {typeInfo.icon}
        {/if}
      </span>
      <span class="type-label">{typeInfo.label}</span>
    </div>
    
    {#if actualRingSize > 0}
      <div class="ring-size-badge">
        <span class="ring-icon"><Link size={12} /></span>
        <span class="ring-count">Ring Size: {actualRingSize}</span>
      </div>
    {/if}
  </div>
  
  <!-- Coinbase Miner Section -->
  {#if isCoinbase && minerAddress}
    <div class="miner-section">
      <div class="miner-header">
        <span class="miner-icon"><Pickaxe size={14} strokeWidth={1.5} /></span>
        <span class="miner-label">Block Miner</span>
      </div>
      <div class="miner-address">
        <AddressDisplay 
          address={minerAddress} 
          truncate={true} 
          size="md"
          showCopy={true}
        />
      </div>
    </div>
  {/if}
  
  <!-- Ring Visualization Circle -->
  {#if displayMembers.length > 0}
    <div class="ring-container">
      <svg viewBox="0 0 200 200" class="ring-svg">
        <!-- Background circle -->
        <circle 
          cx="100" cy="100" 
          r="{compact ? 60 : 85}" 
          fill="none" 
          stroke="rgba(82, 200, 219, 0.1)" 
          stroke-width="2"
          stroke-dasharray="4 4"
        />
        
        <!-- Center info -->
        <text x="100" y="95" text-anchor="middle" class="center-text">
          {actualRingSize}
        </text>
        <text x="100" y="112" text-anchor="middle" class="center-label">
          members
        </text>
        
        <!-- Ring member nodes -->
        {#each displayMembers as member, i}
          {@const pos = getPosition(i, displayMembers.length)}
          <g 
            class="ring-member-node"
            class:hovered={hoveredIndex === i}
            class:selected={selectedIndex === i}
            on:mouseenter={() => hoveredIndex = i}
            on:mouseleave={() => hoveredIndex = null}
            on:click={() => handleMemberClick(member, i)}
          >
            <!-- Connection line to center -->
            <line 
              x1="100" y1="100" 
              x2={pos.x} y2={pos.y}
              stroke={getColor(i)}
              stroke-width="1"
              stroke-opacity="0.3"
              class="connection-line"
            />
            
            <!-- Member dot -->
            <circle 
              cx={pos.x} cy={pos.y} 
              r="{compact ? 8 : 12}"
              fill={getColor(i)}
              stroke="rgba(255,255,255,0.2)"
              stroke-width="2"
              class="member-dot"
            />
            
            <!-- Member index -->
            <text 
              x={pos.x} y={pos.y + (compact ? 3 : 4)} 
              text-anchor="middle" 
              class="member-index"
            >
              {i + 1}
            </text>
          </g>
        {/each}
        
        <!-- Question mark for hidden real sender -->
        <text x="100" y="100" text-anchor="middle" class="question-mark">?</text>
      </svg>
      
      <!-- Hover tooltip -->
      {#if hoveredIndex !== null && displayMembers[hoveredIndex]}
        <div class="ring-tooltip" style="--tooltip-color: {getColor(hoveredIndex)}">
          <div class="tooltip-header">
            <span class="tooltip-index">Member #{hoveredIndex + 1}</span>
          </div>
          <div class="tooltip-address">
            {formatAddress(displayMembers[hoveredIndex], 18)}
          </div>
          <div class="tooltip-hint">Click to select</div>
        </div>
      {/if}
    </div>
    
    <!-- Privacy explanation -->
    <div class="privacy-note">
      <span class="note-icon"><Lock size={12} /></span>
      <span class="note-text">
        The actual sender is hidden among {actualRingSize} possible addresses. This is DERO's ring signature privacy.
      </span>
    </div>
    
    <!-- Toggle full list -->
    <button class="toggle-list-btn" on:click={() => showFullList = !showFullList}>
      {showFullList ? '▲ Hide' : '▼ Show'} Full Member List
    </button>
    
    <!-- Full member list (collapsible) -->
    {#if showFullList}
      <div class="member-list">
        {#each ringMembers as member, i}
          <div 
            class="member-item"
            class:selected={selectedIndex === i}
            style="--item-color: {getColor(i)}"
            on:click={() => handleMemberClick(member, i)}
          >
            <span class="item-index" style="background: {getColor(i)}">{i + 1}</span>
            <span class="item-address">{formatAddress(member, 20)}</span>
            <button class="item-copy" on:click|stopPropagation={() => copyAddress(member)} title="Copy">
              <Copy size={12} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
  {:else if !isCoinbase}
    <!-- No ring members message -->
    <div class="no-ring-message">
      <span class="no-ring-icon"><Info size={16} strokeWidth={1.5} /></span>
      <span class="no-ring-text">No ring member data available for this transaction</span>
    </div>
  {/if}
</div>

<style>
  .ring-visualization {
    background: linear-gradient(135deg, rgba(30, 30, 40, 0.95) 0%, rgba(20, 20, 30, 0.98) 100%);
    border: 1px solid rgba(82, 200, 219, 0.2);
    border-radius: 12px;
    padding: 1.25rem;
  }
  
  .ring-visualization.compact {
    padding: 1rem;
  }
  
  /* Header */
  .ring-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  
  .tx-type-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.8rem;
    background: var(--badge-bg);
    border: 1px solid color-mix(in srgb, var(--badge-color) 40%, transparent);
    border-radius: 20px;
  }
  
  .type-icon {
    font-size: 1rem;
  }
  
  .type-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--badge-color);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .ring-size-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    background: rgba(82, 200, 219, 0.1);
    border: 1px solid rgba(82, 200, 219, 0.3);
    border-radius: 16px;
    font-size: 0.75rem;
    color: #52c8db;
  }
  
  .ring-icon {
    font-size: 0.85rem;
  }
  
  /* Miner Section */
  .miner-section {
    background: rgba(251, 191, 36, 0.08);
    border: 1px solid rgba(251, 191, 36, 0.25);
    border-radius: 10px;
    padding: 1rem;
    margin-bottom: 1rem;
  }
  
  .miner-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  
  .miner-icon {
    font-size: 1.1rem;
  }
  
  .miner-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #fbbf24;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .miner-address {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  /* Ring Container */
  .ring-container {
    position: relative;
    display: flex;
    justify-content: center;
    padding: 1rem 0;
  }
  
  .ring-svg {
    width: 100%;
    max-width: 280px;
    height: auto;
  }
  
  .compact .ring-svg {
    max-width: 200px;
  }
  
  .center-text {
    font-size: 2rem;
    font-weight: 800;
    fill: #52c8db;
  }
  
  .center-label {
    font-size: 0.65rem;
    fill: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  
  .question-mark {
    font-size: 1.5rem;
    fill: rgba(255, 255, 255, 0.15);
    font-weight: bold;
  }
  
  /* Ring member nodes */
  .ring-member-node {
    cursor: pointer;
    transition: transform 0.2s ease;
  }
  
  .ring-member-node:hover .member-dot,
  .ring-member-node.hovered .member-dot {
    r: 14;
    filter: drop-shadow(0 0 8px currentColor);
  }
  
  .ring-member-node.selected .member-dot {
    stroke: #fff;
    stroke-width: 3;
  }
  
  .connection-line {
    transition: stroke-opacity 0.2s;
  }
  
  .ring-member-node:hover .connection-line,
  .ring-member-node.hovered .connection-line {
    stroke-opacity: 0.7;
  }
  
  .member-dot {
    transition: all 0.2s ease;
  }
  
  .member-index {
    font-size: 0.55rem;
    font-weight: 700;
    fill: #fff;
    pointer-events: none;
  }
  
  .compact .member-index {
    font-size: 0.45rem;
  }
  
  /* Tooltip */
  .ring-tooltip {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(20, 20, 30, 0.95);
    border: 1px solid var(--tooltip-color);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    min-width: 200px;
    text-align: center;
    z-index: 10;
    animation: fade-in 0.15s ease;
  }
  
  @keyframes fade-in {
    from { opacity: 0; transform: translateX(-50%) translateY(5px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  
  .tooltip-header {
    margin-bottom: 0.3rem;
  }
  
  .tooltip-index {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--tooltip-color);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .tooltip-address {
    font-family: monospace;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.9);
    word-break: break-all;
  }
  
  .tooltip-hint {
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.4);
    margin-top: 0.3rem;
  }
  
  /* Privacy note */
  .privacy-note {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.75rem;
    background: rgba(74, 222, 128, 0.08);
    border: 1px solid rgba(74, 222, 128, 0.2);
    border-radius: 8px;
    margin-top: 1rem;
  }
  
  .note-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }
  
  .note-text {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.7);
    line-height: 1.4;
  }
  
  /* Toggle button */
  .toggle-list-btn {
    width: 100%;
    padding: 0.6rem;
    margin-top: 0.75rem;
    background: rgba(82, 200, 219, 0.1);
    border: 1px solid rgba(82, 200, 219, 0.2);
    border-radius: 8px;
    color: #52c8db;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .toggle-list-btn:hover {
    background: rgba(82, 200, 219, 0.15);
    border-color: rgba(82, 200, 219, 0.3);
  }
  
  /* Member list */
  .member-list {
    margin-top: 0.75rem;
    max-height: 250px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  
  .member-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.6rem;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-left: 3px solid var(--item-color);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }
  
  .member-item:hover {
    background: rgba(0, 0, 0, 0.35);
    border-color: rgba(255, 255, 255, 0.1);
  }
  
  .member-item.selected {
    background: rgba(82, 200, 219, 0.1);
    border-color: rgba(82, 200, 219, 0.3);
  }
  
  .item-index {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 0.65rem;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }
  
  .item-address {
    flex: 1;
    font-family: monospace;
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.8);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .item-copy {
    background: none;
    border: none;
    font-size: 0.75rem;
    cursor: pointer;
    opacity: 0.4;
    transition: opacity 0.2s;
    padding: 0.2rem;
  }
  
  .item-copy:hover {
    opacity: 1;
  }
  
  /* No ring message */
  .no-ring-message {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1.5rem;
    color: rgba(255, 255, 255, 0.5);
  }
  
  .no-ring-icon {
    font-size: 1.2rem;
  }
  
  .no-ring-text {
    font-size: 0.85rem;
  }
  
  /* Scrollbar */
  .member-list::-webkit-scrollbar {
    width: 4px;
  }
  
  .member-list::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 2px;
  }
  
  .member-list::-webkit-scrollbar-thumb {
    background: rgba(82, 200, 219, 0.3);
    border-radius: 2px;
  }
</style>

