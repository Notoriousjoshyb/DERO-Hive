<script>
  import { fade } from 'svelte/transition';
  
  export let show = true;
</script>

{#if show}
<div class="splash-backdrop" transition:fade={{ duration: 300 }}>
  <!-- V6.2 D2 Hologram Splash - G. Layered Depths + Quick Snap Lock -->
  <div class="splash-scene">
    <!-- Mesh Gradient Background -->
    <div class="bg-gradient"></div>
    
    <!-- Vignette -->
    <div class="vignette"></div>
    
    <!-- Center Glow -->
    <div class="center-glow"></div>
    
    <!-- Interference Bands -->
    <div class="interference-band"></div>
    <div class="interference-band"></div>
    <div class="interference-band"></div>
    
    <!-- Logo Wrapper - D2 Quick Snap Lock Animation -->
    <div class="logo-wrapper">
      <!-- Chromatic Aberration Red Ghost -->
      <div class="chroma-r">
        <svg class="logo-svg" viewBox="0 0 100 100">
          <!-- G. Layered Depths Colorway -->
          <g class="hex-main">
            <polygon points="50,2 95,26 95,74 50,98 5,74 5,26" fill="#67e8f9"/>
            <polygon points="50,7 90,28.5 90,71.5 50,93 10,71.5 10,28.5" fill="#0c1218"/>
            <polygon points="50,13 83,32 83,68 50,87 17,68 17,32" fill="#22d3ee"/>
          </g>
          <polygon class="arrow-top" points="17,32 38,32 38,45 50,50 62,45 62,32 83,32 50,13" fill="#0d4a55"/>
          <polygon class="arrow-bottom" points="62,68 62,55 50,50 38,55 38,68 17,68 50,87 83,68" fill="#0d4a55"/>
        </svg>
      </div>
      
      <!-- Chromatic Aberration Blue Ghost -->
      <div class="chroma-b">
        <svg class="logo-svg" viewBox="0 0 100 100">
          <g class="hex-main">
            <polygon points="50,2 95,26 95,74 50,98 5,74 5,26" fill="#67e8f9"/>
            <polygon points="50,7 90,28.5 90,71.5 50,93 10,71.5 10,28.5" fill="#0c1218"/>
            <polygon points="50,13 83,32 83,68 50,87 17,68 17,32" fill="#22d3ee"/>
          </g>
          <polygon class="arrow-top" points="17,32 38,32 38,45 50,50 62,45 62,32 83,32 50,13" fill="#0d4a55"/>
          <polygon class="arrow-bottom" points="62,68 62,55 50,50 38,55 38,68 17,68 50,87 83,68" fill="#0d4a55"/>
        </svg>
      </div>
      
      <!-- Main Logo with Glow -->
      <svg class="logo-svg main-logo" viewBox="0 0 100 100" style="overflow: visible;">
        <defs>
          <!-- Extended filter bounds to prevent clipping -->
          <filter id="glow-main" x="-100%" y="-100%" width="300%" height="300%" filterUnits="objectBoundingBox">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        <!-- G. Layered Depths Hex Main (frame + void + body) -->
        <g class="hex-main" filter="url(#glow-main)">
          <!-- Outer Frame - Light cyan (brightest layer) -->
          <polygon 
            points="50,2 95,26 95,74 50,98 5,74 5,26" 
            fill="#67e8f9"
          />
          <!-- Inner Void - Dark depth layer -->
          <polygon 
            points="50,7 90,28.5 90,71.5 50,93 10,71.5 10,28.5" 
            fill="#0c1218"
          />
          <!-- Inner Body - Primary cyan H-form -->
          <polygon 
            points="50,13 83,32 83,68 50,87 17,68 17,32" 
            fill="#22d3ee"
          />
        </g>
        
        <!-- Arrow Cutouts - Teal indent (flicker independently) -->
        <polygon 
          class="arrow-top" 
          points="17,32 38,32 38,45 50,50 62,45 62,32 83,32 50,13" 
          fill="#0d4a55"
        />
        <polygon 
          class="arrow-bottom" 
          points="62,68 62,55 50,50 38,55 38,68 17,68 50,87 83,68" 
          fill="#0d4a55"
        />
      </svg>
    </div>
  </div>
</div>
{/if}

<style>
  .splash-backdrop {
    position: fixed;
    inset: 0;
    background: var(--void-base, #0c0c14);
    z-index: 9999;
  }
  
  .splash-scene {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    background: var(--void-base, #0c0c14);
    overflow: hidden;
  }
  
  /* Mesh Gradient Background - subtle and seamless */
  .bg-gradient {
    position: absolute;
    inset: 0;
    background: 
      /* Top ambient - very soft, wide spread */
      radial-gradient(ellipse 150% 80% at 50% -20%, rgba(34, 211, 238, 0.06) 0%, transparent 70%),
      /* Bottom corners - extremely subtle */
      radial-gradient(ellipse 100% 60% at 100% 100%, rgba(167, 139, 250, 0.03) 0%, transparent 60%),
      radial-gradient(ellipse 100% 60% at 0% 100%, rgba(52, 211, 153, 0.02) 0%, transparent 60%);
    pointer-events: none;
  }
  
  /* Vignette */
  .vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 3;
    background: radial-gradient(
      ellipse at center,
      transparent 0%,
      transparent 40%,
      rgba(0, 0, 0, 0.6) 100%
    );
  }
  
  /* Center Glow - Pulses with the snap */
  .center-glow {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 400px;
    height: 400px;
    transform: translate(-50%, -50%);
    background: radial-gradient(
      circle,
      rgba(103, 232, 249, 0.15) 0%,
      rgba(34, 211, 238, 0.08) 40%,
      transparent 70%
    );
    pointer-events: none;
    z-index: 2;
    animation: centerGlowD2 5s ease-out forwards;
    opacity: 0;
  }
  
  /* Interference Bands */
  .interference-band {
    position: absolute;
    width: 100%;
    height: 3px;
    background: rgba(103, 232, 249, 0.4);
    left: 0;
    opacity: 0;
    z-index: 60;
    filter: blur(1px);
    animation: interferenceMove 5s ease-out forwards;
  }
  
  .interference-band:nth-child(4) { animation-delay: 0.4s; }
  .interference-band:nth-child(5) { animation-delay: 0.8s; }
  
  /* Logo Wrapper - D2 Quick Snap Animation */
  .logo-wrapper {
    width: 280px;
    height: 280px;
    position: relative;
    z-index: 10;
    animation: wrapperReveal 5s ease-out forwards;
    opacity: 0;
    /* CRITICAL: Allow glow to extend beyond wrapper bounds */
    overflow: visible;
  }
  
  .logo-svg {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
    /* Allow SVG effects to extend beyond bounds */
    overflow: visible;
  }
  
  /* === HEX MAIN - D2 Quick Snap Lock Animation === */
  .main-logo .hex-main {
    opacity: 0;
    animation: hexMainD2 5s ease-out forwards;
  }
  
  /* === ARROWS - Independent flicker warmup (the "good first half") === */
  .main-logo .arrow-top {
    opacity: 0;
    animation: arrowFlickerTop 5s ease-out forwards;
  }
  
  .main-logo .arrow-bottom {
    opacity: 0;
    animation: arrowFlickerBottom 5s ease-out forwards;
  }
  
  /* Chromatic Aberration Layers */
  .chroma-r,
  .chroma-b {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
  }
  
  .chroma-r { 
    animation: chromaR 5s ease-out forwards; 
    filter: hue-rotate(-35deg);
  }
  
  .chroma-b { 
    animation: chromaB 5s ease-out forwards; 
    filter: hue-rotate(35deg);
  }
  
  /* Chroma layers - hex follows main animation */
  .chroma-r .hex-main,
  .chroma-b .hex-main {
    animation: hexMainD2 5s ease-out forwards;
  }
  
  /* Chroma layers - arrows follow independent flicker */
  .chroma-r .arrow-top,
  .chroma-b .arrow-top {
    animation: arrowFlickerTop 5s ease-out forwards;
  }
  
  .chroma-r .arrow-bottom,
  .chroma-b .arrow-bottom {
    animation: arrowFlickerBottom 5s ease-out forwards;
  }
  
  /* ========================================
     V6.2 D2 - QUICK SNAP LOCK ANIMATIONS
     ======================================== */
  
  /* Wrapper reveal */
  @keyframes wrapperReveal {
    0%, 8% { opacity: 0; }
    10% { opacity: 1; }
    100% { opacity: 1; }
  }
  
  /* HEX MAIN - D2 Quick Snap: First half flicker, then instant flash lock */
  @keyframes hexMainD2 {
    /* FIRST HALF - Flicker warmup */
    0%, 48% { opacity: 0; filter: drop-shadow(0 0 8px rgba(103, 232, 249, 0.5)); }
    50% { opacity: 0.9; }
    52% { opacity: 0; }
    55% { opacity: 0.85; }
    57% { opacity: 0.1; }
    60% { opacity: 0.9; }
    62% { opacity: 0.2; }
    /* LATTER HALF - D2 QUICK SNAP: Immediate flash lock */
    64% { opacity: 0.7; filter: brightness(1.35) drop-shadow(0 0 22px rgba(103, 232, 249, 0.95)); }
    66% { opacity: 1; filter: brightness(1) drop-shadow(0 0 8px rgba(103, 232, 249, 0.5)); }
    100% { opacity: 1; filter: drop-shadow(0 0 8px rgba(103, 232, 249, 0.5)); }
  }
  
  /* ARROW TOP - Independent flicker (starts early at 10%) */
  @keyframes arrowFlickerTop {
    0%, 10% { opacity: 0; }
    12% { opacity: 0.4; }
    15% { opacity: 0.05; }
    20% { opacity: 0.6; }
    24% { opacity: 0.1; }
    30% { opacity: 0.75; }
    35% { opacity: 0.2; }
    42% { opacity: 0.85; }
    48% { opacity: 0.4; }
    55% { opacity: 0.95; }
    65% { opacity: 0.7; }
    80% { opacity: 0.9; }
    100% { opacity: 1; }
  }
  
  /* ARROW BOTTOM - Independent flicker (starts at 30%, delayed response) */
  @keyframes arrowFlickerBottom {
    0%, 30% { opacity: 0; }
    33% { opacity: 0.35; }
    36% { opacity: 0.05; }
    42% { opacity: 0.5; }
    46% { opacity: 0.1; }
    52% { opacity: 0.7; }
    58% { opacity: 0.25; }
    65% { opacity: 0.85; }
    72% { opacity: 0.5; }
    82% { opacity: 0.95; }
    100% { opacity: 1; }
  }
  
  /* CHROMATIC ABERRATION - Red ghost */
  @keyframes chromaR {
    0%, 10% { opacity: 0; transform: translate(0, 0); }
    12% { opacity: 0.5; transform: translate(-6px, 3px); }
    30% { opacity: 0.35; transform: translate(-4px, 2px); }
    60% { opacity: 0.2; transform: translate(-2px, 0); }
    100% { opacity: 0.1; transform: translate(-1px, 0); }
  }
  
  /* CHROMATIC ABERRATION - Blue ghost */
  @keyframes chromaB {
    0%, 10% { opacity: 0; transform: translate(0, 0); }
    12% { opacity: 0.5; transform: translate(6px, -3px); }
    30% { opacity: 0.35; transform: translate(4px, -2px); }
    60% { opacity: 0.2; transform: translate(2px, 0); }
    100% { opacity: 0.1; transform: translate(1px, 0); }
  }
  
  /* Interference bands sweep */
  @keyframes interferenceMove {
    0%, 15% { opacity: 0; top: 15%; }
    18% { opacity: 0.7; top: 22%; }
    20% { opacity: 0; top: 28%; }
    35% { opacity: 0; top: 45%; }
    38% { opacity: 0.5; top: 52%; }
    40% { opacity: 0; top: 58%; }
    55% { opacity: 0; top: 68%; }
    58% { opacity: 0.35; top: 74%; }
    60%, 100% { opacity: 0; top: 80%; }
  }
  
  /* Center glow - D2 snap burst */
  @keyframes centerGlowD2 {
    0%, 10% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
    20% { opacity: 0.3; }
    30% { opacity: 0.1; }
    50% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
    /* SNAP burst at 64% */
    64% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
    70% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
    100% { opacity: 0.5; }
  }
</style>
