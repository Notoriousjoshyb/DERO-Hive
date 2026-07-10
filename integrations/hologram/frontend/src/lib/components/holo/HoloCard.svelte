<script>
  /**
   * HoloCard - v6.1 Card Component
   * 
   * Variants:
   * - default: Basic card with lift on hover
   * - shimmer: Animated gradient border
   * - glow: Cyan glow effect
   * - top: Top gradient bar accent
   */
  export let variant = 'default'; // default | shimmer | glow | top
  export let padding = 'default'; // none | sm | default | lg
  export let clickable = false;
  
  const paddingClasses = {
    none: '',
    sm: 'p-3',
    default: 'p-4',
    lg: 'p-6'
  };
</script>

<div 
  class="holo-card holo-card-{variant} {paddingClasses[padding]}"
  class:cursor-pointer={clickable}
  on:click
  on:keydown
  role={clickable ? 'button' : undefined}
  tabindex={clickable ? 0 : undefined}
>
  <slot />
</div>

<style>
  .holo-card {
    position: relative;
    transition: all 200ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  
  /* v6.1 Default Card - clean panel design */
  .holo-card-default {
    background: var(--void-mid, #12121c);
    border: 1px solid var(--border-default, rgba(255, 255, 255, 0.09));
    border-radius: var(--r-lg, 12px);
  }
  
  .holo-card-default:hover {
    border-color: var(--border-strong, rgba(255, 255, 255, 0.12));
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  
  /* Shimmer Card (animated border) */
  .holo-card-shimmer {
    background: var(--void-mid, #12121c);
    border-radius: var(--r-lg, 12px);
    overflow: hidden;
  }
  
  .holo-card-shimmer::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--r-lg, 12px);
    padding: 1px;
    background: var(--grad-shimmer, linear-gradient(90deg, #0891b2, #a78bfa, #22d3ee, #a78bfa, #0891b2));
    background-size: 300% 100%;
    animation: shimmer 4s linear infinite;
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
  }
  
  @keyframes shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }
  
  /* Glow Card */
  .holo-card-glow {
    background: var(--void-mid, #12121c);
    border: 1px solid var(--cyan-500, #06b6d4);
    border-radius: var(--r-lg, 12px);
    box-shadow: 0 0 8px rgba(34, 211, 238, 0.2);
  }
  
  .holo-card-glow:hover {
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.3);
  }
  
  /* Top Bar Card */
  .holo-card-top {
    background: var(--void-mid, #12121c);
    border: 1px solid var(--border-default, rgba(255, 255, 255, 0.09));
    border-radius: var(--r-lg, 12px);
    overflow: hidden;
  }
  
  .holo-card-top::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--grad-primary, linear-gradient(135deg, #22d3ee 0%, #a78bfa 100%));
  }
  
  /* Clickable state */
  .cursor-pointer:active {
    transform: scale(0.98);
  }
</style>

