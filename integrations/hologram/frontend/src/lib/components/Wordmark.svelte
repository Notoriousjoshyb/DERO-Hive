<script lang="ts">
  /**
   * HOLOGRAM Wordmark Component
   * SVG-based wordmark with configurable size and glow
   * Uses simple CSS drop-shadow for clean glow effect
   */
  
  export let size: 'xs' | 'sm' | 'md' | 'lg' = 'md';
  export let glow: boolean = true;
  export let color: string = 'var(--cyan-400)';
  
  // Aspect ratio: 727.4 / 63.8 ≈ 11.4:1
  // Size presets (height-based, width calculated from aspect ratio)
  const sizes = {
    xs: { width: 91, height: 8 },     // 11px text equivalent
    sm: { width: 114, height: 10 },   // 13px text equivalent  
    md: { width: 137, height: 12 },   // 16px text equivalent
    lg: { width: 228, height: 20 }    // 26px text equivalent (splash)
  };
  
  $: dimensions = sizes[size];
</script>

<svg 
  class="wordmark wordmark-{size}"
  class:glow
  viewBox="0 0 727.4 63.8"
  width={dimensions.width}
  height={dimensions.height}
  fill="none"
  style="--wordmark-color: {color};"
  aria-label="HOLOGRAM"
  role="img"
>
  <g fill="currentColor">
    <!-- H -->
    <polygon points="50.9 26.5 13 26.5 13 3 2.4 3 2.4 60.8 13 60.8 13 37.3 50.9 37.3 50.9 60.8 61.5 60.8 61.5 3 50.9 3 50.9 26.5"/>
    <!-- O -->
    <path d="M146,4.5c-1.7-1-3.5-1.5-5.6-1.5h-35.5c-2,0-3.9.5-5.6,1.5-1.7,1-3,2.4-4.1,4.1-1,1.7-1.5,3.5-1.5,5.6v35.5c0,2,.5,3.9,1.5,5.6,1,1.7,2.4,3,4.1,4.1,1.7,1,3.5,1.5,5.6,1.5h35.5c2,0,3.9-.5,5.6-1.5,1.7-1,3-2.4,4.1-4.1,1-1.7,1.5-3.5,1.5-5.6V14.2c0-2-.5-3.9-1.5-5.6-1-1.7-2.4-3-4.1-4.1ZM140.9,49.2c0,.3-.1.5-.3.7-.2.2-.5.3-.7.3h-34.5c-.3,0-.5,0-.7-.3-.2-.2-.3-.4-.3-.7V14.7c0-.3,0-.5.3-.7.2-.2.4-.3.7-.3h34.5c.3,0,.5,0,.7.3.2.2.3.4.3.7v34.5Z"/>
    <!-- L -->
    <polygon points="200.7 2.9 190.1 2.9 190.1 60.8 247.9 60.8 247.9 50.1 200.7 50.1 200.7 2.9"/>
    <!-- O -->
    <path d="M332.4,4.5c-1.7-1-3.5-1.5-5.6-1.5h-35.5c-2,0-3.9.5-5.6,1.5-1.7,1-3,2.4-4.1,4.1-1,1.7-1.5,3.5-1.5,5.6v35.5c0,2,.5,3.9,1.5,5.6,1,1.7,2.4,3,4.1,4.1,1.7,1,3.5,1.5,5.6,1.5h35.5c2,0,3.9-.5,5.6-1.5,1.7-1,3-2.4,4.1-4.1,1-1.7,1.5-3.5,1.5-5.6V14.2c0-2-.5-3.9-1.5-5.6-1-1.7-2.4-3-4.1-4.1ZM327.3,49.2c0,.3-.1.5-.3.7-.2.2-.5.3-.7.3h-34.5c-.3,0-.5,0-.7-.3-.2-.2-.3-.4-.3-.7V14.7c0-.3,0-.5.3-.7.2-.2.4-.3.7-.3h34.5c.3,0,.5,0,.7.3.2.2.3.4.3.7v34.5Z"/>
    <!-- G -->
    <path d="M426.7,4.5c-1.7-1-3.6-1.5-5.6-1.5h-35.4c-2,0-3.9.5-5.6,1.5-1.7,1-3,2.4-4.1,4.1-1,1.7-1.5,3.5-1.5,5.6v35.5c0,2,.5,3.9,1.5,5.6,1,1.7,2.4,3,4.1,4.1,1.7,1,3.5,1.5,5.6,1.5h35.4c2,0,3.9-.5,5.6-1.5,1.7-1,3.1-2.4,4.1-4.1,1-1.7,1.5-3.5,1.5-5.6v-21.6h-23.8v10.7h13.1v10.4c0,.3-.1.5-.3.7-.2.2-.5.3-.7.3h-34.5c-.3,0-.5,0-.7-.3-.2-.2-.3-.4-.3-.7V14.7c0-.3,0-.5.3-.7.2-.2.4-.3.7-.3h34.5c.3,0,.5,0,.7.3.2.2.3.4.3.7v4h10.7v-4.5c0-2-.5-3.9-1.5-5.6-1-1.7-2.4-3-4.1-4.1Z"/>
    <!-- R -->
    <path d="M521.1,4.6c-1.7-1-3.6-1.5-5.6-1.5h-46.6v57.7h10.6v-19.7h18.9s16.6,19.7,16.6,19.7h11.6v-3l-14.3-16.8h3.2c2,0,3.9-.5,5.6-1.5,1.7-1,3.1-2.3,4.1-4.1,1-1.7,1.5-3.6,1.5-5.6v-15.6c0-2-.5-3.9-1.5-5.6-1-1.7-2.4-3-4.1-4.1ZM516,29.4c0,.3-.1.5-.3.6-.2.2-.5.2-.7.2h-34.5c-.3,0-.5,0-.7-.2-.2-.2-.3-.4-.3-.6v-14.8c0-.3,0-.5.3-.7.2-.2.4-.3.7-.3h34.5c.3,0,.5,0,.7.3.2.2.3.4.3.7v14.8Z"/>
    <!-- A -->
    <path d="M616.4,4.5c-1.7-1-3.6-1.5-5.6-1.5h-35.4c-2,0-3.9.5-5.6,1.5-1.7,1-3,2.4-4.1,4.1-1,1.7-1.5,3.5-1.5,5.6v46.6h10.6v-19.4h36.5v19.4h10.7V14.2c0-2-.5-3.9-1.5-5.6-1-1.7-2.4-3-4.1-4.1ZM611.3,30.8h-36.5V14.7c0-.3,0-.5.3-.7s.4-.3.7-.3h34.5c.3,0,.5,0,.7.3.2.2.3.4.3.7v16.1Z"/>
    <!-- M -->
    <polygon points="713.3 3 692.4 28 671.5 3 659.9 3 659.9 60.8 670.5 60.8 670.5 18.5 692.4 44.5 714.4 18.4 714.4 60.8 725 60.8 725 3 713.3 3"/>
  </g>
</svg>

<style>
  .wordmark {
    color: var(--wordmark-color, var(--cyan-400));
    display: block;
    flex-shrink: 0;
  }
  
  /* Simple, clean glow - single drop-shadow */
  .wordmark.glow {
    filter: drop-shadow(0 0 8px rgba(34, 211, 238, 0.6));
  }
  
  /* Large wordmark - splash/wizard - PREMIUM holographic glow */
  .wordmark-lg {
    margin-bottom: 24px; /* More space for glow to breathe */
  }
  
  .wordmark-lg.glow {
    /* Layered glow: inner sharp + mid diffuse + outer ambient */
    filter: 
      drop-shadow(0 0 2px rgba(34, 211, 238, 0.9))
      drop-shadow(0 0 8px rgba(34, 211, 238, 0.7))
      drop-shadow(0 0 20px rgba(34, 211, 238, 0.5))
      drop-shadow(0 0 40px rgba(34, 211, 238, 0.3))
      drop-shadow(0 0 60px rgba(34, 211, 238, 0.15));
    animation: wordmark-pulse 4s ease-in-out infinite;
  }
  
  @keyframes wordmark-pulse {
    0%, 100% {
      filter: 
        drop-shadow(0 0 2px rgba(34, 211, 238, 0.9))
        drop-shadow(0 0 8px rgba(34, 211, 238, 0.7))
        drop-shadow(0 0 20px rgba(34, 211, 238, 0.5))
        drop-shadow(0 0 40px rgba(34, 211, 238, 0.3))
        drop-shadow(0 0 60px rgba(34, 211, 238, 0.15));
    }
    50% {
      filter: 
        drop-shadow(0 0 3px rgba(34, 211, 238, 1))
        drop-shadow(0 0 12px rgba(34, 211, 238, 0.8))
        drop-shadow(0 0 28px rgba(34, 211, 238, 0.6))
        drop-shadow(0 0 50px rgba(34, 211, 238, 0.35))
        drop-shadow(0 0 80px rgba(34, 211, 238, 0.2));
    }
  }
  
  /* Medium wordmark */
  .wordmark-md {
    margin-bottom: 8px;
  }
  
  /* Small wordmark - sidebar */
  .wordmark-sm.glow {
    filter: drop-shadow(0 0 6px rgba(34, 211, 238, 0.5));
  }
  
  /* Extra small wordmark */
  .wordmark-xs.glow {
    filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.4));
  }
</style>
