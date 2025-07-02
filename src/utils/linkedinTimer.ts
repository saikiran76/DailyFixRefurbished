import logger from '@/utils/logger';

// LinkedIn timer constants
const LINKEDIN_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes in milliseconds
const LINKEDIN_LAST_SWITCH_KEY = 'linkedin_last_switch_time';
const LINKEDIN_LAST_CHECK_KEY = 'linkedin_last_check_time';
const LINKEDIN_CACHED_STATUS_KEY = 'linkedin_cached_connection_status';

/**
 * LinkedIn Timer Management Utility
 * Handles time-based connection status checks for LinkedIn platform
 */
export class LinkedInTimer {
  
  /**
   * Records when user switches to LinkedIn platform
   */
  static recordLinkedInSwitch(): void {
    const now = Date.now();
    localStorage.setItem(LINKEDIN_LAST_SWITCH_KEY, now.toString());
    logger.info('[LinkedInTimer] Recorded LinkedIn platform switch at:', new Date(now).toISOString());
  }
  
  /**
   * Records when we last checked LinkedIn connection status via API
   */
  static recordLinkedInCheck(): void {
    const now = Date.now();
    localStorage.setItem(LINKEDIN_LAST_CHECK_KEY, now.toString());
    logger.info('[LinkedInTimer] Recorded LinkedIn API check at:', new Date(now).toISOString());
  }
  
  /**
   * Checks if 15 minutes have passed since last LinkedIn API check
   * @returns {boolean} true if API check is needed, false if we can use cached status
   */
  static shouldCheckLinkedInStatus(): boolean {
    const lastCheckTime = localStorage.getItem(LINKEDIN_LAST_CHECK_KEY);
    
    if (!lastCheckTime) {
      // No previous check recorded, we should check
      logger.info('[LinkedInTimer] No previous LinkedIn check found, API check needed');
      return true;
    }
    
    const timeSinceLastCheck = Date.now() - parseInt(lastCheckTime);
    const shouldCheck = timeSinceLastCheck >= LINKEDIN_CHECK_INTERVAL;
    
    logger.info('[LinkedInTimer] LinkedIn timer check:', {
      lastCheckTime: new Date(parseInt(lastCheckTime)).toISOString(),
      timeSinceLastCheck: `${Math.round(timeSinceLastCheck / 1000 / 60)} minutes`,
      shouldCheck,
      nextCheckIn: shouldCheck ? 'now' : `${Math.round((LINKEDIN_CHECK_INTERVAL - timeSinceLastCheck) / 1000 / 60)} minutes`
    });
    
    return shouldCheck;
  }
  
  /**
   * Gets cached LinkedIn connection status
   * @returns {boolean | null} cached status or null if no cache exists
   */
  static getCachedLinkedInStatus(): boolean | null {
    const cachedStatus = localStorage.getItem(LINKEDIN_CACHED_STATUS_KEY);
    if (cachedStatus === null) {
      return null;
    }
    
    const status = cachedStatus === 'true';
    logger.info('[LinkedInTimer] Retrieved cached LinkedIn status:', status);
    return status;
  }
  
  /**
   * Caches LinkedIn connection status
   * @param {boolean} isConnected - current connection status
   */
  static setCachedLinkedInStatus(isConnected: boolean): void {
    localStorage.setItem(LINKEDIN_CACHED_STATUS_KEY, isConnected.toString());
    logger.info('[LinkedInTimer] Cached LinkedIn status:', isConnected);
  }
  
  /**
   * Gets time remaining until next LinkedIn check
   * @returns {number} milliseconds until next check, or 0 if check is due
   */
  static getTimeUntilNextCheck(): number {
    const lastCheckTime = localStorage.getItem(LINKEDIN_LAST_CHECK_KEY);
    
    if (!lastCheckTime) {
      return 0; // No previous check, check is due now
    }
    
    const timeSinceLastCheck = Date.now() - parseInt(lastCheckTime);
    const timeRemaining = Math.max(0, LINKEDIN_CHECK_INTERVAL - timeSinceLastCheck);
    
    return timeRemaining;
  }
  
  /**
   * Gets formatted time remaining until next LinkedIn check
   * @returns {string} human-readable time remaining
   */
  static getFormattedTimeUntilNextCheck(): string {
    const timeRemaining = this.getTimeUntilNextCheck();
    
    if (timeRemaining === 0) {
      return 'Check due now';
    }
    
    const minutes = Math.ceil(timeRemaining / 1000 / 60);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  
  /**
   * Resets all LinkedIn timer data (useful for logout/reset scenarios)
   */
  static resetLinkedInTimer(): void {
    localStorage.removeItem(LINKEDIN_LAST_SWITCH_KEY);
    localStorage.removeItem(LINKEDIN_LAST_CHECK_KEY);
    localStorage.removeItem(LINKEDIN_CACHED_STATUS_KEY);
    logger.info('[LinkedInTimer] Reset all LinkedIn timer data');
  }
  
  /**
   * Gets debug information about LinkedIn timer state
   * @returns {object} debug information
   */
  static getDebugInfo(): {
    lastSwitchTime: string | null;
    lastCheckTime: string | null;
    cachedStatus: boolean | null;
    shouldCheck: boolean;
    timeUntilNextCheck: string;
    intervalMinutes: number;
  } {
    const lastSwitchTime = localStorage.getItem(LINKEDIN_LAST_SWITCH_KEY);
    const lastCheckTime = localStorage.getItem(LINKEDIN_LAST_CHECK_KEY);
    
    return {
      lastSwitchTime: lastSwitchTime ? new Date(parseInt(lastSwitchTime)).toISOString() : null,
      lastCheckTime: lastCheckTime ? new Date(parseInt(lastCheckTime)).toISOString() : null,
      cachedStatus: this.getCachedLinkedInStatus(),
      shouldCheck: this.shouldCheckLinkedInStatus(),
      timeUntilNextCheck: this.getFormattedTimeUntilNextCheck(),
      intervalMinutes: LINKEDIN_CHECK_INTERVAL / 1000 / 60
    };
  }
}

export default LinkedInTimer; 