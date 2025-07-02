import api from '@/utils/api';
import logger from '@/utils/logger';
import { handleError, ErrorTypes, AppError } from '@/utils/errorHandler';
// import { getState, getUserId } from '@/utils/storeStatesUtils';

const WHATSAPP_API_PREFIX = '/api/v1/whatsapp';
const TELEGRAM_API_PREFIX = '/api/v1/telegram';
const LINKEDIN_API_PREFIX = '/api/v1/linkedin';
const INSTAGRAM_API_PREFIX = '/api/v1/instagram';

/**
 * Service for managing contacts across platforms
 * @class ContactService
 */
class ContactService {
  cache: Map<string, { contacts: any[]; timestamp: number; }>;
  syncInProgress: Map<string, boolean>;
  lastSyncTime: Map<string, number>;
  CACHE_TTL: number;
  apiFailures: Map<string, number>;
  apiBackoff: Map<string, number>;

  constructor() {
    this.cache = new Map<string, { contacts: any[], timestamp: number }>();
    this.syncInProgress = new Map();
    this.lastSyncTime = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    this.apiFailures = new Map();
    this.apiBackoff = new Map();
  }

  /**
   * Records an API failure for exponential backoff
   */
  recordApiFailure(apiKey: string) {
    const currentFailures = this.apiFailures.get(apiKey) || 0;
    this.apiFailures.set(apiKey, currentFailures + 1);
    
    // Set backoff time (exponential: 1s, 2s, 4s, 8s, etc.)
    const backoffTime = Math.min(1000 * Math.pow(2, currentFailures), 30000); // Max 30s
    this.apiBackoff.set(apiKey, Date.now() + backoffTime);
    
    console.warn(`[ContactService] API failure recorded for ${apiKey}, backoff until: ${new Date(Date.now() + backoffTime)}`);
  }

  /**
   * Resets API failure count for successful calls
   */
  resetApiFailureCount(apiKey: string) {
    this.apiFailures.delete(apiKey);
    this.apiBackoff.delete(apiKey);
  }

  /**
   * Checks if we should retry API calls (not in backoff period)
   */
  shouldRetryApiCall(apiKey: string): boolean {
    const backoffUntil = this.apiBackoff.get(apiKey);
    if (!backoffUntil) return true;
    
    const now = Date.now();
    if (now > backoffUntil) {
      // Backoff period expired, clear it
      this.apiBackoff.delete(apiKey);
      return true;
    }
    
    return false;
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
      
      // ENHANCED: Get platform-specific API prefix
      let apiPrefix;
      switch (platform) {
        case 'whatsapp':
          apiPrefix = WHATSAPP_API_PREFIX;
          break;
        case 'telegram':
          apiPrefix = TELEGRAM_API_PREFIX;
          break;
        case 'linkedin':
          apiPrefix = LINKEDIN_API_PREFIX;
          break;
        case 'instagram':
          apiPrefix = INSTAGRAM_API_PREFIX;
          break;
        default:
          apiPrefix = WHATSAPP_API_PREFIX;
      }
      
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

      // ENHANCED: Use platform-specific API prefix
      let apiPrefix;
      switch (platform) {
        case 'whatsapp':
          apiPrefix = WHATSAPP_API_PREFIX;
          break;
        case 'telegram':
          apiPrefix = TELEGRAM_API_PREFIX;
          break;
        case 'linkedin':
          apiPrefix = LINKEDIN_API_PREFIX;
          break;
        case 'instagram':
          apiPrefix = INSTAGRAM_API_PREFIX;
          break;
        default:
          apiPrefix = WHATSAPP_API_PREFIX;
      }
      
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
  async syncContact(contactId: string, isWhatsAppConnected: boolean) {
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

      if (!isWhatsAppConnected) {
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
   * @param {string} [userId] - Optional user ID to clear specific cache
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