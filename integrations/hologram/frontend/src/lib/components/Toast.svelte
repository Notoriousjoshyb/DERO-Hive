<script>
  import { fly, fade } from 'svelte/transition';
  import { toastNotifications, dismissToast } from '../stores/appState.js';

  // Toast type configurations with v6.1 compliant classes
  const typeConfig = {
    info: {
      icon: 'i',
      className: 'toast-info',
    },
    success: {
      icon: '✓',
      className: 'toast-success',
    },
    warning: {
      icon: '!',
      className: 'toast-warning',
    },
    error: {
      icon: '✕',
      className: 'toast-error',
    },
  };

  function getConfig(type) {
    return typeConfig[type] || typeConfig.info;
  }
</script>

<!-- Toast Container - fixed position at top right -->
<div class="toast-container">
  {#each $toastNotifications as toast (toast.id)}
    {@const config = getConfig(toast.type)}
    <div
      class="toast {config.className}"
      in:fly={{ x: 300, duration: 300 }}
      out:fade={{ duration: 200 }}
    >
      <!-- Icon -->
      <span class="toast-icon">{config.icon}</span>
      
      <!-- Message -->
      <div class="toast-content">
        <p class="toast-message">{toast.message}</p>
      </div>
      
      <!-- Dismiss button -->
      <button
        on:click={() => dismissToast(toast.id)}
        class="toast-dismiss"
        aria-label="Dismiss"
      >
        <svg class="dismiss-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  {/each}
</div>

<style>
  /* === HOLOGRAM v6.1 Toast Notifications === */
  
  .toast-container {
    position: fixed;
    top: var(--s-4, 16px);
    right: var(--s-4, 16px);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: var(--s-2, 8px);
    pointer-events: none;
    max-width: 320px;
  }
  
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: var(--s-3, 12px);
    padding: var(--s-3, 12px) var(--s-4, 16px);
    border-radius: var(--r-lg, 12px);
    border: 1px solid;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(8px);
  }
  
  /* Toast Types */
  .toast-info {
    background: rgba(34, 211, 238, 0.15);
    border-color: rgba(34, 211, 238, 0.4);
  }
  
  .toast-info .toast-icon {
    color: var(--cyan-400, #22d3ee);
  }
  
  .toast-success {
    background: rgba(52, 211, 153, 0.15);
    border-color: rgba(52, 211, 153, 0.4);
  }
  
  .toast-success .toast-icon {
    color: var(--status-ok, #34d399);
  }
  
  .toast-warning {
    background: rgba(251, 191, 36, 0.15);
    border-color: rgba(251, 191, 36, 0.4);
  }
  
  .toast-warning .toast-icon {
    color: var(--status-warn, #fbbf24);
  }
  
  .toast-error {
    background: rgba(248, 113, 113, 0.15);
    border-color: rgba(248, 113, 113, 0.4);
  }
  
  .toast-error .toast-icon {
    color: var(--status-err, #f87171);
  }
  
  /* Toast Elements */
  .toast-icon {
    flex-shrink: 0;
    font-size: 16px;
    font-weight: 700;
  }
  
  .toast-content {
    flex: 1;
    min-width: 0;
  }
  
  .toast-message {
    font-size: 13px;
    color: var(--text-1, #f8f8fc);
    word-break: break-word;
  }
  
  .toast-dismiss {
    flex-shrink: 0;
    padding: var(--s-1, 4px);
    margin-right: calc(var(--s-1, 4px) * -1);
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-4, #505068);
    transition: color 200ms ease-out;
  }
  
  .toast-dismiss:hover {
    color: var(--text-2, #a8a8b8);
  }
  
  .dismiss-icon {
    width: 16px;
    height: 16px;
  }
</style>
