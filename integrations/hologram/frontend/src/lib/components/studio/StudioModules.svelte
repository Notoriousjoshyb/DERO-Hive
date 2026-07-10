<script>
  import { AlertTriangle, ArrowRight, Library, Loader2, Puzzle, Search } from 'lucide-svelte';

  export let modSearchQuery = '';
  export let selectedModClass = 'all';
  export let allMods = [];
  export let modClasses = [];
  export let filteredMods = [];
  export let modsLoading = false;
  export let modsError = '';
  export let loadModsData = () => {};
  export let openModDetails = () => {};
  export let getModClassIcon = () => null;
</script>

<div class="content-section modules-section">
  <h2 class="content-section-title">DVM Modules</h2>
  <p class="content-section-desc">Browse and install modular DVM code extensions for your smart contracts.</p>
  
  <!-- Search and Filter -->
  <div class="mods-toolbar">
    <label class="search-box">
      <Search size={16} />
      <input
        type="text"
        bind:value={modSearchQuery}
        placeholder="Search modules..."
        class="search-input"
      />
    </label>
    
    <div class="mods-filter-buttons">
      <button
        on:click={() => selectedModClass = 'all'}
        class="mods-filter-btn"
        class:active={selectedModClass === 'all'}
      >
        <Library size={14} />
        All
        <span class="filter-count">({allMods.length})</span>
      </button>
      {#each modClasses as cls}
        <button
          on:click={() => selectedModClass = cls.name}
          class="mods-filter-btn"
          class:active={selectedModClass === cls.name}
        >
          <svelte:component this={getModClassIcon(cls.name)} size={14} />
          {cls.name}
          <span class="filter-count">({cls.modCount})</span>
        </button>
      {/each}
    </div>
  </div>
  
  <!-- Modules Grid -->
  {#if modsLoading}
    <div class="mods-loading">
      <Loader2 size={32} class="spin" />
      <p>Loading modules...</p>
    </div>
  {:else if modsError}
    <div class="mods-error">
      <AlertTriangle size={32} />
      <p>{modsError}</p>
      <button on:click={loadModsData} class="btn btn-secondary">Retry</button>
    </div>
  {:else if filteredMods.length === 0}
    <div class="mods-empty">
      <Puzzle size={32} />
      <p>No modules found</p>
      {#if modSearchQuery || selectedModClass !== 'all'}
        <button on:click={() => { modSearchQuery = ''; selectedModClass = 'all'; }} class="btn btn-ghost">
          Clear filters
        </button>
      {/if}
    </div>
  {:else}
    <div class="mods-grid">
      {#each filteredMods as mod}
        <button class="mod-card" on:click={() => openModDetails(mod)}>
          <div class="mod-card-icon">
            <svelte:component this={getModClassIcon(mod.class)} size={24} />
          </div>
          <div class="mod-card-content">
            <div class="mod-card-name">{mod.name}</div>
            <div class="mod-card-meta">
              <span class="badge badge-cyan">{mod.class}</span>
              <span class="mod-card-tag">by {mod.tag}</span>
            </div>
            <p class="mod-card-desc">{mod.description || 'No description available'}</p>
          </div>
          <ArrowRight size={16} class="mod-card-arrow" />
        </button>
      {/each}
    </div>
  {/if}
</div>
