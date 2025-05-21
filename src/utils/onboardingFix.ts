/**
 * Utility to prevent duplicate step updates in the onboarding flow
 */

// Flag to track if we have a pending update to the complete step
let pendingCompleteUpdate = false;

/**
 * Check if we should allow a transition to the complete step
 * @returns {boolean} - Whether the transition should be allowed
 */
export const shouldAllowCompleteTransition = () => {
  if (pendingCompleteUpdate) {
    return false;
  }
  
  pendingCompleteUpdate = true;
  
  // Reset the flag after 5 seconds to prevent permanent blocking
  setTimeout(() => {
    pendingCompleteUpdate = false;
  }, 5000);
  
  return true;
};

/**
 * Reset the pending complete update flag
 */
export const resetPendingCompleteUpdate = () => {
  pendingCompleteUpdate = false;
};

