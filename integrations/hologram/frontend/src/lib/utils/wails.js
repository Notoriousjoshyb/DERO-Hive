/**
 * Wails Runtime Utilities
 * 
 * Helpers for ensuring Wails bindings are ready before use.
 */

/**
 * Wait for Wails Go bindings to be available.
 * This resolves a timing issue where Svelte components mount before
 * window['go']['main']['App'] is initialized by the Wails runtime.
 * 
 * @param {number} timeout - Max time to wait in ms (default: 5000)
 * @param {number} interval - Polling interval in ms (default: 50)
 * @returns {Promise<boolean>} - Resolves true when ready, rejects on timeout
 */
export function waitForWails(timeout = 5000, interval = 50) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    function check() {
      // Check if Wails Go bindings are available
      if (window['go']?.['main']?.['App']) {
        resolve(true);
        return;
      }
      
      // Check for timeout
      if (Date.now() - startTime > timeout) {
        reject(new Error('Wails runtime initialization timeout'));
        return;
      }
      
      // Try again
      setTimeout(check, interval);
    }
    
    check();
  });
}

