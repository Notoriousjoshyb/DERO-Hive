<script>
  /**
   * DotIndicator - v6.1 Status Dot Component
   * 
   * Variants:
   * - cyan: Primary/online state
   * - ok: Success/connected state
   * - warn: Warning state (with pulse animation)
   * - err: Error/disconnected state
   */
  export let status = 'cyan'; // cyan | ok | warn | err
  export let size = 'default'; // sm | default | lg
  
  const sizeClasses = {
    sm: 'dot-sm',
    default: 'dot-default',
    lg: 'dot-lg'
  };
</script>

<span class="holo-dot holo-dot-{status} {sizeClasses[size]}"></span>

<style>
  .holo-dot {
    border-radius: 50%;
    flex-shrink: 0;
  }
  
  /* Size variants */
  .dot-sm {
    width: 5px;
    height: 5px;
  }
  
  .dot-default {
    width: 7px;
    height: 7px;
  }
  
  .dot-lg {
    width: 10px;
    height: 10px;
  }
  
  /* Status variants */
  .holo-dot-cyan { 
    background: var(--cyan-400, #22d3ee); 
    box-shadow: 0 0 8px var(--cyan-400, #22d3ee); 
  }
  
  .holo-dot-ok { 
    background: var(--status-ok, #34d399); 
    box-shadow: 0 0 8px var(--status-ok, #34d399); 
  }
  
  .holo-dot-warn { 
    background: var(--status-warn, #fbbf24); 
    box-shadow: 0 0 8px var(--status-warn, #fbbf24); 
    animation: pulse 2s ease infinite;
  }
  
  .holo-dot-err { 
    background: var(--status-err, #f87171); 
    box-shadow: 0 0 8px var(--status-err, #f87171); 
  }
  
  @keyframes pulse { 
    0%, 100% { opacity: 1; } 
    50% { opacity: 0.5; } 
  }
</style>

