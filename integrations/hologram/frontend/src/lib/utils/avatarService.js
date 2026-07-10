import VillagerIdenticon from './villager-identicon.js';
import { GetSCVariable } from '../../../wailsjs/go/main/App.js';

// Villager Smart Contract ID (Mainnet)
let VILLAGER_SCID = 'f0b29081c1ed35fe942cb3402cd9d7bf0cf27639201bbc96223bdc99c4c6aa9f';

/**
 * Get the current Villager smart contract ID
 * @returns {string} The SCID for the Villager avatar contract
 */
export function getVillagerSCID() {
    return VILLAGER_SCID;
}

// Empty avatar string (576 'z' characters = all transparent pixels)
const EMPTY_AVATAR = 'z'.repeat(576);

// Cache for avatar URLs (address -> URL)
const avatarUrlCache = new Map();

// Cache for avatar pixel strings (address -> pixel string)
const avatarPixelCache = new Map();

/**
 * Hex string to 576-character pixel string
 */
function hexToString(hex) {
    if (hex.length !== 1152 || !/^[0-9a-fA-F]{1152}$/.test(hex)) {
        throw new Error("Invalid hex string – must be exactly 1152 hex chars");
    }
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
}

/**
 * Fetch avatar pixels from smart contract using direct daemon call
 * @param {string} address - Wallet address
 * @returns {Promise<string|null>} - 576-character pixel string or null if not found
 */
async function fetchAvatarPixels(address) {
    if (!address) return null;
    
    // Check cache first
    if (avatarPixelCache.has(address)) {
        return avatarPixelCache.get(address);
    }
    
    try {
        // Call smart contract using direct daemon RPC (works without XSWD)
        const response = await GetSCVariable(VILLAGER_SCID, [`avatar_${address}`]);
        
        if (response?.success && response?.valuesstring?.[0]) {
            const avatarHex = response.valuesstring[0];
            // Decode hex to 576-char string
            const avatarStr = hexToString(avatarHex);
            
            // Cache the result
            avatarPixelCache.set(address, avatarStr);
            return avatarStr;
        }
        
        // No avatar found, return null
        return null;
    } catch (error) {
        console.error('Failed to fetch avatar from SC:', error);
        return null;
    }
}

/**
 * Get avatar URL for an address
 * Fetches custom pixels from blockchain and renders with identicon frame
 * @param {string} address - Wallet address
 * @param {number} size - Requested size in pixels (default: 40)
 * @returns {Promise<string>} - Object URL for the avatar image
 */
export async function getAvatarUrl(address, size = 40) {
    if (!address) {
        throw new Error('Address is required');
    }
    
    // Check if we have a cached URL for this address and size
    const cacheKey = `${address}_${size}`;
    if (avatarUrlCache.has(cacheKey)) {
        return avatarUrlCache.get(cacheKey);
    }
    
    // Fetch custom pixels from blockchain (or use empty if none found)
    let avatarStr = EMPTY_AVATAR;
    try {
        const pixels = await fetchAvatarPixels(address);
        if (pixels && pixels.length === 576) {
            avatarStr = pixels;
        }
    } catch (err) {
        console.error('Failed to fetch avatar pixels:', err);
        // Continue with empty avatar
    }
    
    // Render avatar with identicon frame
    try {
        const url = await VillagerIdenticon.render(address, avatarStr, size);
        avatarUrlCache.set(cacheKey, url);
        return url;
    } catch (error) {
        console.error('Failed to render avatar:', error);
        throw error;
    }
}

/**
 * Clear avatar cache for an address
 * @param {string} address - Wallet address (optional, clears all if not provided)
 */
export function clearAvatarCache(address = null) {
    if (address) {
        // Clear specific address
        const keysToDelete = [];
        avatarUrlCache.forEach((value, key) => {
            if (key.startsWith(`${address}_`)) {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach(key => {
            const url = avatarUrlCache.get(key);
            if (url) URL.revokeObjectURL(url);
            avatarUrlCache.delete(key);
        });
        avatarPixelCache.delete(address);
    } else {
        // Clear all
        avatarUrlCache.forEach(url => URL.revokeObjectURL(url));
        avatarUrlCache.clear();
        avatarPixelCache.clear();
        VillagerIdenticon.clearCache();
    }
}

