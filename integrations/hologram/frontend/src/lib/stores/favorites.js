import { writable, get } from 'svelte/store';

// Create a writable store for favorites
function createFavoritesStore() {
  // Load initial favorites from localStorage
  let initial = [];
  try {
    const stored = localStorage.getItem('hologram_favorites');
    if (stored) {
      initial = JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load favorites:', e);
  }

  const { subscribe, set, update } = writable(initial);

  // Save to localStorage whenever favorites change
  function persist(favorites) {
    try {
      localStorage.setItem('hologram_favorites', JSON.stringify(favorites));
    } catch (e) {
      console.error('Failed to save favorites:', e);
    }
  }

  return {
    subscribe,
    
    // Add a favorite
    add: (app) => {
      update(favorites => {
        // Don't add duplicates
        const exists = favorites.some(f => (app.scid && f.scid === app.scid) || (app.durl && f.durl === app.durl));
        if (exists) return favorites;
        
        const newFavorite = {
          scid: app.scid,
          durl: app.durl || null,
          name: app.display_name || app.name || 'Unnamed App',
          icon: app.icon || null,
          addedAt: Date.now()
        };
        
        const updated = [newFavorite, ...favorites];
        persist(updated);
        return updated;
      });
    },
    
    // Remove a favorite by scid or durl
    remove: (identifier) => {
      update(favorites => {
        // Clean identifier if it has dero:// prefix
        const cleanId = identifier.startsWith('dero://') ? identifier.slice(7) : identifier;
        const updated = favorites.filter(f => 
          f.scid !== cleanId && f.durl !== cleanId
        );
        persist(updated);
        return updated;
      });
    },
    
    // Check if an app is favorited
    isFavorite: (identifier) => {
      const favorites = get({ subscribe });
      return favorites.some(f => 
        f.scid === identifier || f.durl === identifier || 
        `dero://${f.durl}` === identifier ||
        `dero://${f.scid}` === identifier
      );
    },
    
    // Toggle favorite status
    toggle: (app) => {
      const favorites = get({ subscribe });
      const exists = favorites.some(f => 
        (app.scid && f.scid === app.scid) || (app.durl && f.durl === app.durl)
      );
      
      if (exists) {
        update(favs => {
          const updated = favs.filter(f => 
            !( (app.scid && f.scid === app.scid) || (app.durl && f.durl === app.durl) )
          );
          persist(updated);
          return updated;
        });
        return false; // Now unfavorited
      } else {
        update(favs => {
          const newFavorite = {
            scid: app.scid,
            durl: app.durl || null,
            name: app.display_name || app.name || 'Unnamed App',
            icon: app.icon || null,
            addedAt: Date.now()
          };
          const updated = [newFavorite, ...favs];
          persist(updated);
          return updated;
        });
        return true; // Now favorited
      }
    },
    
    // Clear all favorites
    clear: () => {
      set([]);
      persist([]);
    }
  };
}

export const favorites = createFavoritesStore();

