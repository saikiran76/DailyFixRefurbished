import api from '@/utils/api';
import logger from '@/utils/logger';
import { handleError, ErrorTypes, AppError } from '@/utils/errorHandler';
// Removed unused imports: isWhatsAppConnected, isTelegramConnected
// import { getState, getUserId } from '@/utils/storeStatesUtils';

const WHATSAPP_API_PREFIX = '/api/v1/whatsapp';
const MATRIX_API_PREFIX = '/api/v1/matrix';

/**
 * Service for managing contacts across platforms
 * @class ContactService
 */
class ContactService {
  cache: Map<string, { contacts: any[]; timestamp: number; }>;
  syncInProgress: Map<string, boolean>;
  lastSyncTime: Map<string, number>;
  CACHE_TTL: number;
  // Add exponential backoff tracking
  private apiFailureCount: Map<string, number>;
  private lastApiFailure: Map<string, number>;
  private readonly MAX_RETRIES = 3;
  private readonly BASE_BACKOFF_MS = 2000; // 2 seconds base

  constructor() {
    this.cache = new Map<string, { contacts: any[], timestamp: number }>();
    this.syncInProgress = new Map();
    this.lastSyncTime = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    this.apiFailureCount = new Map();
    this.lastApiFailure = new Map();
  }

  /**
   * Calculate exponential backoff with jitter
   * @param {number} attempt - Current attempt number (0-based)
   * @returns {number} Backoff time in milliseconds
   */
  private calculateBackoff(attempt: number): number {
    const exponentialDelay = this.BASE_BACKOFF_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    return Math.min(exponentialDelay + jitter, 60000); // Cap at 60 seconds
  }

  /**
   * Check if we should retry API call based on failure count and backoff
   * @param {string} key - Platform or user key
   * @returns {boolean} Whether to retry
   */
  private shouldRetryApiCall(key: string): boolean {
    const failureCount = this.apiFailureCount.get(key) || 0;
    const lastFailure = this.lastApiFailure.get(key) || 0;
    const now = Date.now();
    
    // If we've exceeded max retries, check if enough time has passed for reset
    if (failureCount >= this.MAX_RETRIES) {
      const resetTime = 300000; // 5 minutes
      if (now - lastFailure > resetTime) {
        // Reset failure count after extended period
        this.apiFailureCount.set(key, 0);
        this.lastApiFailure.delete(key);
        return true;
      }
      return false;
    }
    
    // Check if we're in backoff period
    if (failureCount > 0) {
      const backoffTime = this.calculateBackoff(failureCount - 1);
      if (now - lastFailure < backoffTime) {
        logger.debug(`[ContactService] API call for ${key} is in backoff period (${Math.round((backoffTime - (now - lastFailure)) / 1000)}s remaining)`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Record API failure for exponential backoff
   * @param {string} key - Platform or user key
   */
  private recordApiFailure(key: string): void {
    const currentCount = this.apiFailureCount.get(key) || 0;
    this.apiFailureCount.set(key, currentCount + 1);
    this.lastApiFailure.set(key, Date.now());
    
    const newCount = currentCount + 1;
    logger.warn(`[ContactService] API failure recorded for ${key} (${newCount}/${this.MAX_RETRIES})`);
    
    if (newCount >= this.MAX_RETRIES) {
      logger.error(`[ContactService] Max retries exceeded for ${key}, backing off for extended period`);
    }
  }

  /**
   * Reset API failure count on successful call
   * @param {string} key - Platform or user key
   */
  private resetApiFailureCount(key: string): void {
    this.apiFailureCount.delete(key);
    this.lastApiFailure.delete(key);
  }

  /**
   * Validates and returns cached contacts if available
   */
  _getCachedContacts(userId: string) {
    const cached = this.cache.get(userId);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > this.CACHE_TTL;
    if (isExpired) {
      this.clearCache(userId);
      return null;
    }

    return cached.contacts;
  }

  /**
   * Gets a specific contact by ID
   * @param {string} contactId - The contact ID
   * @returns {Promise<Object>} Contact data
   */
  async getContact(contactId) {
    if (!contactId) {
      throw new AppError(ErrorTypes.VALIDATION, 'Contact ID is required');
    }

    try {
      const response = await api.get(`${WHATSAPP_API_PREFIX}/contacts/${contactId}`);
      if (!response?.data?.data) {
        throw new AppError(ErrorTypes.NETWORK, 'Invalid response from contact API');
      }
      return response.data.data;
    } catch (error) {
      logger.error('[ContactService] Error fetching contact:', error);
      throw handleError(error, 'Failed to fetch contact');
    }
  }

  /**
   * Gets contacts for the current user with proper sync state handling
   */
  async getCurrentUserContacts(userId: string, isConnected: boolean, platform: string = 'whatsapp') {
    try {
      if (!userId) {
        logger.warn('[ContactService] No authenticated user found');
        throw new AppError(ErrorTypes.AUTH, 'No authenticated user found');
      }

      // CRITICAL FIX: Check platform connection first
      if (!isConnected) {
        logger.info(`[ContactService] ${platform} is not connected, returning empty contacts list`);
        return { contacts: [] };
      }

      // Check if we should retry API calls for this platform
      const apiKey = `${platform}-${userId}`;
      if (!this.shouldRetryApiCall(apiKey)) {
        logger.warn(`[ContactService] API calls for ${platform} are in backoff period, returning cached data`);
        const cachedContacts = this._getCachedContacts(userId);
        return { contacts: cachedContacts || [] };
      }

      // CRITICAL FIX: Check if we're requesting the correct platform
      const activeContactList = localStorage.getItem('dailyfix_active_platform');
      if (activeContactList && activeContactList !== platform) {
        logger.info(`[ContactService] Requested contacts for ${platform} but active platform is ${activeContactList}, returning empty list`);
        return { contacts: [] };
      }

      logger.info(`[ContactService] Fetching ${platform} contacts for user:`, userId);

      // Check if sync is in progress
      if (this.syncInProgress.get(userId)) {
        logger.info(`[ContactService] Sync in progress for user:`, userId);
        return { inProgress: true };
      }

      // Try cache only if sync is not in progress and cache is valid
      const cachedContacts = this._getCachedContacts(userId);
      if (cachedContacts) {
        logger.info(`[ContactService] Returning cached ${platform} contacts for user:`, userId);
        return { contacts: cachedContacts };
      }

      // If no cache, initiate a fresh fetch
      return this.getUserContacts(userId, isConnected, platform);
    } catch (error) {
      logger.error(`[ContactService] Error fetching ${platform} contacts for user:`, error);
      throw handleError(error, `Failed to fetch ${platform} contacts`);
    }
  }

  /**
   * Gets contacts for a specific user
   */
  async getUserContacts(userId: string, isConnected: boolean, platform: string = 'whatsapp') {
    if (!userId) {
      throw new AppError(ErrorTypes.VALIDATION, 'User ID is required');
    }

    const apiKey = `${platform}-${userId}`;

    try {
      // CRITICAL FIX: Check platform connection before making API calls
      if (!isConnected) {
        logger.info(`[ContactService] ${platform} is not connected, returning empty contacts list`);
        return { contacts: [] };
      }

      // Check if we should retry API calls
      if (!this.shouldRetryApiCall(apiKey)) {
        logger.warn(`[ContactService] API calls for ${platform} are in backoff period, returning empty list`);
        return { contacts: [] };
      }

      // CRITICAL FIX: Check if this is the active platform
      const activeContactList = localStorage.getItem('dailyfix_active_platform');
      if (activeContactList && activeContactList !== platform) {
        logger.info(`[ContactService] Requested contacts for ${platform} but active platform is ${activeContactList}, returning empty list`);
        return { contacts: [] };
      }

      // Only proceed with API request if platform is connected
      logger.info(`[ContactService] ${platform} is connected, fetching contacts`);
      const apiPrefix = platform === 'whatsapp' ? WHATSAPP_API_PREFIX : `/api/v1/${platform}`;
      const response = await api.get(`${apiPrefix}/contacts`);

      // Reset failure count on successful API call
      this.resetApiFailureCount(apiKey);

      // Log the response for debugging
      logger.info(`[ContactService] Raw ${platform} API response:`, response?.data);

      // Check for different possible response structures
      const contacts = response?.data?.data;

      if (!contacts || !Array.isArray(contacts)) {
        logger.error(`[ContactService] Invalid ${platform} response structure:`, response?.data);
        throw new AppError(ErrorTypes.NETWORK, `Invalid response from ${platform} contacts API`);
      }

      // Cache the results
      this.cache.set(userId, {
        contacts: contacts,
        timestamp: Date.now()
      });

      logger.info(`[ContactService] Successfully fetched ${platform} contacts for user:`, userId);
      return { contacts: contacts };
    } catch (error) {
      // Record API failure for exponential backoff
      this.recordApiFailure(apiKey);
      
      logger.error(`[ContactService] Error fetching ${platform} contacts:`, {
        error: error.message,
        stack: error.stack,
        userId
      });
      throw handleError(error, `Failed to fetch ${platform} contacts`);
    }
  }

  // fresh sync request - onDemand

  async performFreshSync(userId: string, isConnected: boolean, platform: string = 'whatsapp') {
    const apiKey = `${platform}-${userId}-sync`;
    
    try {
      if (!userId) {
        throw new AppError(ErrorTypes.AUTH, 'No authenticated user found');
      }

      // CRITICAL FIX: Check if platform is connected before making API requests
      if (!isConnected) {
        logger.info(`[ContactService] ${platform} is not connected, skipping fresh sync`);
        return { contacts: [], message: `${platform} is not connected` };
      }

      // Check if we should retry API calls
      if (!this.shouldRetryApiCall(apiKey)) {
        logger.warn(`[ContactService] Fresh sync for ${platform} is in backoff period, skipping`);
        return { contacts: [], message: `Fresh sync for ${platform} is temporarily unavailable` };
      }

      logger.info(`[ContactService] Starting fresh sync for ${platform} for user:`, userId);

      // Clear existing cache
      this.clearCache(userId);

      // CRITICAL FIX: Use platform-specific API prefix
      const apiPrefix = platform === 'whatsapp' ? WHATSAPP_API_PREFIX : `/api/v1/${platform}`;
      logger.info(`[ContactService] Using API prefix for fresh sync: ${apiPrefix}`);

      // Make API call to fresh sync endpoint with correct platform
      const response = await api.get(`${apiPrefix}/freshSyncContacts`);

      // Reset failure count on successful API call
      this.resetApiFailureCount(apiKey);

      // Update cache with fresh data
      if (response?.data?.data) {
        this.cache.set(userId, {
          contacts: response.data.data,
          timestamp: Date.now()
        });
      }

      logger.info(`[ContactService] Fresh sync completed for ${platform}:`, {
        userId,
        contactCount: response?.data?.data?.length || 0
      });

      return response.data;
    } catch (error) {
      // Record API failure for exponential backoff
      this.recordApiFailure(apiKey);
      
      logger.error(`[ContactService] Fresh sync failed for ${platform}:`, error);
      throw handleError(error, `Failed to perform fresh sync for ${platform}`);
    }
  }

  /**
   * Gets sync status for a user
   */
  async getSyncStatus(userId) {
    if (!userId) return null;
    return this.syncInProgress.get(userId) || null;
  }

  /**
   * Sets sync status for a user
   */
  setSyncStatus(userId, status) {
    if (!userId) return;
    if (status) {
      this.syncInProgress.set(userId, status);
    } else {
      this.syncInProgress.delete(userId);
    }
    logger.info('[ContactService] Sync status updated for user:', userId, status);
  }

  /**
   * Syncs a specific contact
   * @param {string} contactId - The contact ID to sync
   * @returns {Promise<Object>} Sync result
   */
  async syncContact(contactId: string, isConnected: boolean) {
    if (!contactId) {
      throw new AppError(ErrorTypes.VALIDATION, 'Contact ID is required');
    }

    if (this.syncInProgress.get(contactId)) {
      logger.info('[ContactService] Sync already in progress for contact:', contactId);
      return { status: 'in_progress' };
    }

    try {
      // CRITICAL FIX: Check if WhatsApp is connected before making API requests
      // const state = getState();
      // const { whatsappConnected, accounts } = state.onboarding;

      // Check if WhatsApp is connected using multiple sources
      // const isWhatsAppConnected = whatsappConnected ||
      //                         accounts.some(acc => acc.platform === 'whatsapp' && acc.status === 'active');

      if (!isConnected) {
        logger.info('[ContactService] WhatsApp is not connected, skipping contact sync');
        return { status: 'skipped', reason: 'whatsapp_not_connected' };
      }

      this.syncInProgress.set(contactId, true);
      logger.info('[ContactService] Starting sync for contact:', contactId);

      const response = await api.post(`${WHATSAPP_API_PREFIX}/contacts/${contactId}/sync`);

      if (!response?.data) {
        throw new AppError(ErrorTypes.NETWORK, 'Invalid response from sync API');
      }

      // Update last sync time
      this.lastSyncTime.set(contactId, Date.now());

      // Clear cache to force fresh data on next fetch
      this.clearCache(null);

      logger.info('[ContactService] Successfully synced contact:', contactId);
      return response.data;
    } catch (error) {
      logger.error('[ContactService] Error syncing contact:', error);
      throw handleError(error, 'Failed to sync contact');
    } finally {
      this.syncInProgress.set(contactId, false);
    }
  }

  /**
   * Updates a contact's status
   * @param {string} contactId - The contact ID
   * @param {Object} status - The new status
   * @returns {Promise<Object>} Updated contact
   */
  async updateContactStatus(contactId, status) {
    if (!contactId) {
      throw new AppError(ErrorTypes.VALIDATION, 'Contact ID is required');
    }

    try {
      logger.info('[ContactService] Updating contact status:', { contactId, status });
      const response = await api.patch(`${WHATSAPP_API_PREFIX}/contacts/${contactId}/status`, status);

      if (!response?.data?.data) {
        throw new AppError(ErrorTypes.NETWORK, 'Invalid response from status update API');
      }

      // Clear cache to ensure fresh data on next fetch
      this.clearCache(null);

      logger.info('[ContactService] Successfully updated contact status:', contactId);
      return response.data.data;
    } catch (error) {
      logger.error('[ContactService] Error updating contact status:', error);
      throw handleError(error, 'Failed to update contact status');
    }
  }

  /**
   * Clears the contact cache for a specific user or all users
   * @param {string|null} userId - Optional user ID to clear specific cache, null for all
   */
  clearCache(userId: string | null) {
    if (userId) {
      this.cache.delete(userId);
      logger.info('[ContactService] Cleared cache for user:', userId);
    } else {
      this.cache.clear();
      logger.info('[ContactService] Cleared all contact cache');
    }
  }
}

// Create singleton instance
const contactService = new ContactService();

// Named export to match imports
export { contactService };

// Also provide default export for flexibility
export default contactService;