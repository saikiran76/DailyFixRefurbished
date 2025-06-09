import api from '@/utils/api';
import logger from '@/utils/logger';
import { handleError, ErrorTypes, AppError } from '@/utils/errorHandler';
// import { getState, getUserId } from '@/utils/storeStatesUtils';

const WHATSAPP_API_PREFIX = '/api/v1/whatsapp';
const MATRIX_API_PREFIX = '/api/matrix';

/**
 * Service for managing contacts across platforms
 * @class ContactService
 */
class ContactService {
  cache: Map<string, { contacts: any[]; timestamp: number; }>;
  syncInProgress: Map<string, boolean>;
  lastSyncTime: Map<string, number>;
  CACHE_TTL: number;

  constructor() {
    this.cache = new Map<string, { contacts: any[], timestamp: number }>();
    this.syncInProgress = new Map();
    this.lastSyncTime = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
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
        throw new AppError(ErrorTypes.API, 'Invalid response from contact API');
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
  async getCurrentUserContacts(userId: string, isWhatsAppConnected: boolean, platform: string = 'whatsapp') {
    try {
      if (!userId) {
        logger.warn('[ContactService] No authenticated user found');
        throw new AppError(ErrorTypes.AUTH, 'No authenticated user found');
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
      return this.getUserContacts(userId, isWhatsAppConnected, platform);
    } catch (error) {
      logger.error(`[ContactService] Error fetching ${platform} contacts for user:`, error);
      throw handleError(error, `Failed to fetch ${platform} contacts`);
    }
  }

  /**
   * Gets contacts for a specific user
   */
  async getUserContacts(userId: string, isWhatsAppConnected: boolean, platform: string = 'whatsapp') {
    if (!userId) {
      throw new AppError(ErrorTypes.VALIDATION, 'User ID is required');
    }

    try {
      // CRITICAL FIX: Check if this is the active platform
      const activeContactList = localStorage.getItem('dailyfix_active_platform');
      if (activeContactList && activeContactList !== platform) {
        logger.info(`[ContactService] Requested contacts for ${platform} but active platform is ${activeContactList}, returning empty list`);
        return { contacts: [] };
      }

      // Check if platform is connected
      if (platform === 'whatsapp' && !isWhatsAppConnected) {
        logger.info('[ContactService] WhatsApp is not connected, returning empty contacts list');
        return { contacts: [] };
      }

      // Only proceed with API request if platform is connected
      logger.info(`[ContactService] ${platform} is connected, fetching contacts`);
      const apiPrefix = platform === 'whatsapp' ? WHATSAPP_API_PREFIX : `/api/v1/${platform}`;
      const response = await api.get(`${apiPrefix}/contacts`);

      // Log the response for debugging
      logger.info(`[ContactService] Raw ${platform} API response:`, response?.data);

      // Check for different possible response structures
      const contacts = response?.data?.data;

      if (!contacts || !Array.isArray(contacts)) {
        logger.error(`[ContactService] Invalid ${platform} response structure:`, response?.data);
        throw new AppError(ErrorTypes.API, `Invalid response from ${platform} contacts API`);
      }

      // Cache the results
      this.cache.set(userId, {
        contacts: contacts,
        timestamp: Date.now()
      });

      logger.info(`[ContactService] Successfully fetched ${platform} contacts for user:`, userId);
      return { contacts: contacts };
    } catch (error) {
      logger.error(`[ContactService] Error fetching ${platform} contacts:`, {
        error: error.message,
        stack: error.stack,
        userId
      });
      throw handleError(error, `Failed to fetch ${platform} contacts`);
    }
  }

  // fresh sync request - onDemand

  async performFreshSync(userId: string, isWhatsAppConnected: boolean) {
    try {
      // const userId = state.auth.session?.user?.id;
      // const { whatsappConnected, accounts } = state.onboarding;

      if (!userId) {
        throw new AppError(ErrorTypes.AUTH, 'No authenticated user found');
      }

      // CRITICAL FIX: Check if WhatsApp is connected before making API requests
      // const isWhatsAppConnected = whatsappConnected ||
      //                         accounts.some(acc => acc.platform === 'whatsapp' && acc.status === 'active');

      if (!isWhatsAppConnected) {
        logger.info('[ContactService] WhatsApp is not connected, skipping fresh sync');
        return [];
      }

      logger.info('[ContactService] Starting fresh sync for user:', userId);

      // Clear existing cache
      this.clearCache(userId);

      // Make API call to fresh sync endpoint
      const response = await api.get(`${WHATSAPP_API_PREFIX}/freshSyncContacts`);

      // Update cache with fresh data
      if (response?.data?.data) {
        this.cache.set(userId, {
          contacts: response.data.data,
          timestamp: Date.now()
        });
      }

      logger.info('[ContactService] Fresh sync completed:', {
        userId,
        contactCount: response?.data?.data?.length || 0
      });

      return response.data;
    } catch (error) {
      logger.error('[ContactService] Fresh sync failed:', error);
      throw handleError(error, 'Failed to perform fresh sync');
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
        throw new AppError(ErrorTypes.API, 'Invalid response from sync API');
      }

      // Update last sync time
      this.lastSyncTime.set(contactId, Date.now());

      // Clear cache to force fresh data on next fetch
      this.clearCache();

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
        throw new AppError(ErrorTypes.API, 'Invalid response from status update API');
      }

      // Clear cache to ensure fresh data on next fetch
      this.clearCache();

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