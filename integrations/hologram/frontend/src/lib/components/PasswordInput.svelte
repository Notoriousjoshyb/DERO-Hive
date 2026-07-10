<script>
  import { Eye, EyeOff } from 'lucide-svelte';
  
  export let value = '';
  export let placeholder = 'Enter password';
  export let autocomplete = 'off';
  export let hasError = false;
  export let onEnter = null;
  
  let showPassword = false;
  
  function handleKeydown(e) {
    if (e.key === 'Enter' && onEnter) {
      onEnter();
    }
  }
</script>

<div class="input-wrap">
  {#if showPassword}
    <input 
      type="text" 
      class="input" 
      class:input-error={hasError}
      bind:value 
      {placeholder} 
      {autocomplete}
      on:keydown={handleKeydown}
    />
  {:else}
    <input 
      type="password" 
      class="input" 
      class:input-error={hasError}
      bind:value 
      {placeholder} 
      {autocomplete}
      on:keydown={handleKeydown}
    />
  {/if}
  <button 
    type="button" 
    class="input-action" 
    on:click={() => showPassword = !showPassword}
  >
    {#if showPassword}
      <EyeOff size={16} strokeWidth={1.5} />
    {:else}
      <Eye size={16} strokeWidth={1.5} />
    {/if}
  </button>
</div>
