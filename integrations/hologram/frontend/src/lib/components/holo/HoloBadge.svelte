<script>
  /**
   * HoloBadge - v6.1 Badge Component
   * 
   * Variants:
   * - cyan: Primary cyan accent
   * - violet: Secondary violet accent
   * - emerald: Tertiary emerald accent
   * - ok: Success/positive
   * - warn: Warning/caution
   * - err: Error/danger
   * - live: Live indicator with pulsing dot
   */
  export let variant = 'cyan'; // cyan | violet | emerald | ok | warn | err | live
</script>

<span class="holo-badge holo-badge-{variant}">
  {#if variant === 'live'}
    <span class="live-dot"></span>
  {/if}
  <slot />
</span>

<style>
  .holo-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px;
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-radius: var(--r-xs, 3px);
    border: 1px solid;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }
  
  /* Color variants */
  .holo-badge-cyan { 
    border-color: var(--cyan-500, #06b6d4); 
    color: var(--cyan-400, #22d3ee); 
  }
  
  .holo-badge-violet { 
    border-color: var(--violet-500, #8b5cf6); 
    color: var(--violet-400, #a78bfa); 
  }
  
  .holo-badge-emerald { 
    border-color: var(--emerald-500, #10b981); 
    color: var(--emerald-400, #34d399); 
  }
  
  .holo-badge-ok { 
    border-color: var(--status-ok, #34d399); 
    color: var(--status-ok, #34d399); 
  }
  
  .holo-badge-warn { 
    border-color: var(--status-warn, #fbbf24); 
    color: var(--status-warn, #fbbf24); 
  }
  
  .holo-badge-err { 
    border-color: var(--status-err, #f87171); 
    color: var(--status-err, #f87171); 
  }
  
  /* Live badge with pulsing dot */
  .holo-badge-live {
    border-color: var(--status-ok, #34d399);
    color: var(--status-ok, #34d399);
    background: rgba(52, 211, 153, 0.08);
  }
  
  .live-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--status-ok, #34d399);
    animation: livePulse 1.5s ease-in-out infinite;
  }
  
  @keyframes livePulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>

