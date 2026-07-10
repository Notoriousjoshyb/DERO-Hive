<script>
  import QRCode from 'qrcode';
  import { onMount } from 'svelte';
  
  export let value = '';
  export let size = 200;
  export let darkColor = '#22d3ee';    // cyan-400
  export let lightColor = '#0c0c14';   // void-base
  
  let canvas;
  
  async function generateQR() {
    if (!canvas || !value) return;
    
    try {
      await QRCode.toCanvas(canvas, value, {
        width: size,
        margin: 2,
        color: {
          dark: darkColor,
          light: lightColor
        }
      });
    } catch (err) {
      console.error('QR code generation failed:', err);
    }
  }
  
  onMount(() => {
    generateQR();
  });
  
  $: if (canvas && value) {
    generateQR();
  }
</script>

<div class="qr-container" style="width: {size}px; height: {size}px;">
  {#if value}
    <canvas bind:this={canvas}></canvas>
  {:else}
    <div class="qr-placeholder">
      <span>No address</span>
    </div>
  {/if}
</div>

<style>
  .qr-container {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--void-base);
    border-radius: var(--r-md);
    padding: var(--s-3);
    border: 1px solid var(--border-subtle);
  }
  
  canvas {
    display: block;
    border-radius: var(--r-sm);
  }
  
  .qr-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-4);
    font-size: 12px;
  }
</style>
