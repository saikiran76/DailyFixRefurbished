/**
 * Utility functions for debouncing and throttling
 */

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds have elapsed
 * since the last time the debounced function was invoked.
 * 
 * @param {Function} func - The function to debounce
 * @param {number} wait - The number of milliseconds to delay
 * @param {boolean} immediate - Whether to invoke the function immediately
 * @returns {Function} - The debounced function
 */
export function debounce(func, wait, immediate = false) {
  let timeout;
  
  return function executedFunction(...args) {
    const context = this;
    
    const later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    
    const callNow = immediate && !timeout;
    
    clearTimeout(timeout);
    
    timeout = setTimeout(later, wait);
    
    if (callNow) func.apply(context, args);
  };
}

/**
 * Creates a throttled function that only invokes func at most once per every wait milliseconds.
 * 
 * @param {Function} func - The function to throttle
 * @param {number} wait - The number of milliseconds to wait between invocations
 * @returns {Function} - The throttled function
 */
export function throttle(func, wait) {
  let lastCall = 0;
  
  return function executedFunction(...args) {
    const now = Date.now();
    
    if (now - lastCall >= wait) {
      func.apply(this, args);
      lastCall = now;
    }
  };
}

export default {
  debounce,
  throttle
};
