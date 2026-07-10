/**
 * Network-scoped localStorage keys for Explorer / OmniSearch history.
 * Prevents simulator-only hashes from appearing after switching to mainnet (or vice versa).
 */

const LEGACY_RECENT = 'recentSearches';
const LEGACY_PINNED = 'pinnedSearches';

function sanitizeNetwork(network) {
  if (!network || typeof network !== 'string') return 'mainnet';
  const n = network.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return n || 'mainnet';
}

export function recentSearchesKey(network) {
  return `recentSearches_${sanitizeNetwork(network)}`;
}

export function pinnedSearchesKey(network) {
  return `pinnedSearches_${sanitizeNetwork(network)}`;
}

let legacyMigrated = false;

/**
 * Remove legacy unscoped keys once. We do not copy them to mainnet: the old single list
 * could mix simulator-only hashes with mainnet; copying would preserve the wrong-row bug.
 */
export function migrateLegacyExplorerSearchStorage() {
  if (typeof localStorage === 'undefined' || legacyMigrated) return;
  legacyMigrated = true;
  try {
    localStorage.removeItem(LEGACY_RECENT);
    localStorage.removeItem(LEGACY_PINNED);
  } catch (e) {
    console.warn('[recentSearchStorage] migrate failed:', e);
  }
}
