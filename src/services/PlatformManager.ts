import logger from '../utils/logger';
// import roomListManager from '../utils/roomListManager';
// import slidingSyncManager from '../utils/SlidingSyncManager';
import { getSocket, disconnectSocket } from '../utils/socketManager';
import { 
  isWhatsAppConnected,
  getWhatsAppConnectionStatus,
  isTelegramConnected,
  getTelegramConnectionStatus,
  isInstagramConnected,
  getInstagramConnectionStatus,
  isLinkedInConnected,
  getLinkedInConnectionStatus,
  saveTelegramConnectionStatus,
  saveWhatsAppConnectionStatus,
  saveInstagramConnectionStatus,
  saveLinkedInConnectionStatus
} from '../utils/connectionStorage';
import api from '../utils/api';

// Add interface for global window object to include matrixClient and toast
declare global {
  interface Window {
    matrixClient: any;
    toast?: {
      error: (message: string) => void;
      success: (message: string) => void;
    };
  }
}

/**
 * Platform state type
 */
interface PlatformState {
  active: boolean;
  lastInitialized: Date;
  lastCleanup?: Date;
  options: any;
}

/**
 * API Status Response type - Updated to match new backend API structure
 */
interface PlatformStatusResponse {
  status: 'never_connected' | 'active' | 'inactive' | 'error' | 'unknown';
  message: string;
  isLoggedIn: boolean;
  hasMatrixAccount: boolean;
  phoneNumber: string | null;
  verified: boolean;
  data?: any;
}

/**
 * PlatformManager service
 * Handles platform-specific initialization, cleanup, and switching with real-time API verification
 */
class PlatformManager {
  private activePlatform: string | null = null;
  public availablePlatforms: string[] = ['whatsapp', 'telegram', 'instagram', 'linkedin'];
  private platformStates: Map<string, PlatformState> = new Map();
  private platformInitializers: { [key: string]: (options?: any) => Promise<boolean> } = {};
  private platformCleanupHandlers: { [key: string]: () => Promise<boolean> } = {};
  private isCheckingStatus: boolean = false;
  private isVerifyingConnection: boolean = false;
  private lastApiCheck: Map<string, number> = new Map(); // Track last API check per platform
  private readonly API_CHECK_COOLDOWN = 5000; // 5 seconds cooldown between API checks
  private apiFailureCount: Map<string, number> = new Map(); // Track API failures per platform
  private lastApiFailure: Map<string, number> = new Map();
  private readonly MAX_RETRIES = 3; // Maximum retry attempts
  private readonly BASE_BACKOFF_MS = 1000; // Base backoff time in milliseconds
  // CRITICAL FIX: Add global flag to prevent multiple simultaneous never-connected checks
  private isCheckingNeverConnected: boolean = false;

  constructor() {
    this.activePlatform = null;
    this.platformStates = new Map();
    this.lastApiCheck = new Map();
    this.apiFailureCount = new Map();
    this.isCheckingNeverConnected = false;
    // this.platformInitializers = {  -- deprecated client side handlers
    //   'telegram': this.initializeTelegram.bind(this),
    //   'whatsapp': this.initializeWhatsApp.bind(this)
    // };
    // this.platformCleanupHandlers = {
    //   'telegram': this.cleanupTelegram.bind(this),
    //   'whatsapp': this.cleanupWhatsApp.bind(this)
    // };

    logger.info('[PlatformManager] Service initialized with real-time API verification and exponential backoff');
  }

  /**
   * Calculate exponential backoff with jitter
   * @param {number} attempt - Current attempt number (0-based)
   * @returns {number} Backoff time in milliseconds
   */
  private calculateBackoff(attempt: number): number {
    // Exponential backoff: base * (2^attempt) + random jitter
    const exponentialDelay = this.BASE_BACKOFF_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Check if we should retry API call based on failure count
   * @param {string} platform - Platform to check
   * @returns {boolean} Whether to retry
   */
  private shouldRetryApiCall(platform: string): boolean {
    const failureCount = this.apiFailureCount.get(platform) || 0;
    return failureCount < this.MAX_RETRIES;
  }

  /**
   * Reset API failure count for platform
   * @param {string} platform - Platform to reset
   */
  private resetApiFailureCount(platform: string): void {
    this.apiFailureCount.set(platform, 0);
  }

  /**
   * Increment API failure count for platform
   * @param {string} platform - Platform to increment
   */
  private incrementApiFailureCount(platform: string): void {
    const currentCount = this.apiFailureCount.get(platform) || 0;
    this.apiFailureCount.set(platform, currentCount + 1);
  }

  /**
   * Get whether we're currently checking platform status
   * @returns {boolean} Status checking state
   */
  isStatusCheckInProgress(): boolean {
    return this.isCheckingStatus;
  }

  /**
   * Set status checking state
   * @param {boolean} checking - Whether we're checking status
   */
  setStatusChecking(checking: boolean): void {
    this.isCheckingStatus = checking;
  }
  
  /**
   * Check if a connection verification is in progress
   * @returns {boolean} Verification status
   */
  isVerificationInProgress(): boolean {
    return this.isVerifyingConnection;
  }
  
  /**
   * Set verification state
   * @param {boolean} verifying - Whether verification is in progress
   */
  setVerifyingConnection(verifying: boolean): void {
    this.isVerifyingConnection = verifying;
  }

  /**
   * Call API to get real-time platform status
   * @param {string} platform - Platform to check (whatsapp or telegram)
   * @returns {Promise<PlatformStatusResponse>} Platform status from API
   */
  private async checkPlatformStatusAPI(platform: string): Promise<PlatformStatusResponse> {
    try {
      // Check if we should retry based on failure count
      if (!this.shouldRetryApiCall(platform)) {
        logger.warn(`[PlatformManager] Max retries exceeded for ${platform}, skipping API call`);
        throw new Error(`Max retries exceeded for ${platform}`);
      }

      // Check cooldown to avoid excessive API calls
      const lastCheck = this.lastApiCheck.get(platform) || 0;
      const now = Date.now();
      
      // Calculate dynamic cooldown based on failure count
      const failureCount = this.apiFailureCount.get(platform) || 0;
      const dynamicCooldown = failureCount > 0 ? this.calculateBackoff(failureCount - 1) : this.API_CHECK_COOLDOWN;
      
      if (now - lastCheck < dynamicCooldown) {
        logger.debug(`[PlatformManager] API check for ${platform} is on cooldown (${Math.round((dynamicCooldown - (now - lastCheck)) / 1000)}s remaining)`);
        throw new Error(`API check on cooldown for ${platform}`);
      }

      logger.info(`[PlatformManager] Checking ${platform} status via API (attempt ${failureCount + 1}/${this.MAX_RETRIES})`);

      // CRITICAL FIX: Use correct API endpoint path
      const response = await api.get(`/api/v1/matrix/${platform}/status`);

      this.lastApiCheck.set(platform, now);
      
      // Reset failure count on successful API call
      this.resetApiFailureCount(platform);

      logger.info(`[PlatformManager] API response for ${platform}:`, response.data);

      // Handle the new API response structure
      const apiData = response.data;
      
      return {
        status: apiData?.status || 'unknown',
        message: apiData?.message || 'Unknown status',
        isLoggedIn: apiData?.isLoggedIn || false,
        hasMatrixAccount: apiData?.hasMatrixAccount || false,
        phoneNumber: apiData?.phoneNumber || null,
        verified: apiData?.verified !== undefined ? apiData.verified : true,
        data: apiData
      };
    } catch (error) {
      // Increment failure count
      this.incrementApiFailureCount(platform);
      const failureCount = this.apiFailureCount.get(platform) || 0;
      
      logger.error(`[PlatformManager] Error checking ${platform} status via API (failure ${failureCount}/${this.MAX_RETRIES}):`, error.message);
      
      // If we've exceeded max retries, stop trying for a longer period
      if (failureCount >= this.MAX_RETRIES) {
        logger.warn(`[PlatformManager] Max retries exceeded for ${platform}, backing off for extended period`);
        // Set last check to now + extended backoff to prevent further attempts
        this.lastApiCheck.set(platform, Date.now() + 300000); // 5 minutes
      }
      
      return {
        status: 'error',
        message: `Failed to check ${platform} status: ${error.message}`,
        isLoggedIn: false,
        hasMatrixAccount: false,
        phoneNumber: null,
        verified: false
      };
    }
  }

  /**
   * Update localStorage based on real API status
   * @param {string} platform - Platform to update
   * @param {PlatformStatusResponse} apiStatus - Status from API
   * @returns {boolean} Whether connection status changed
   */
  private updateLocalStorageFromAPI(platform: string, apiStatus: PlatformStatusResponse): boolean {
    try {
      const authDataStr = localStorage.getItem('dailyfix_auth');
      if (!authDataStr) {
        logger.warn(`[PlatformManager] No auth data found for ${platform} status update`);
        return false;
      }

      const authData = JSON.parse(authDataStr);
      const userId = authData?.user?.id;
      if (!userId) {
        logger.warn(`[PlatformManager] No user ID found for ${platform} status update`);
        return false;
      }

      // Get current local status
      let currentStatus;
      if (platform === 'whatsapp') {
        currentStatus = getWhatsAppConnectionStatus(userId);
      } else if (platform === 'telegram') {
        currentStatus = getTelegramConnectionStatus(userId);
      } else if (platform === 'instagram') {
        currentStatus = getInstagramConnectionStatus(userId);
      } else if (platform === 'linkedin') {
        currentStatus = getLinkedInConnectionStatus(userId);
      } else {
        logger.warn(`[PlatformManager] Unknown platform: ${platform}`);
        return false;
      }

      // Determine connection status based on new API response
      const isConnected = apiStatus.status === 'active';
      const statusChanged = currentStatus?.isConnected !== isConnected;

      // Update localStorage with API-verified status
      const newStatus = {
        isConnected,
        verified: apiStatus.verified,
        lastVerified: Date.now(),
        verificationAttempts: 0,
        // Store additional API response data
        hasMatrixAccount: apiStatus.hasMatrixAccount,
        phoneNumber: apiStatus.phoneNumber,
        lastStatusCheck: apiStatus.status,
        statusMessage: apiStatus.message
      };

      if (platform === 'whatsapp') {
        saveWhatsAppConnectionStatus(userId, newStatus);
      } else if (platform === 'telegram') {
        saveTelegramConnectionStatus(userId, newStatus);
      } else if (platform === 'instagram') {
        saveInstagramConnectionStatus(userId, newStatus);
      } else if (platform === 'linkedin') {
        saveLinkedInConnectionStatus(userId, newStatus);
      }

      logger.info(`[PlatformManager] Updated ${platform} localStorage status:`, {
        connected: isConnected,
        verified: newStatus.verified,
        hasMatrixAccount: apiStatus.hasMatrixAccount,
        status: apiStatus.status,
        changed: statusChanged
      });

      return statusChanged;
    } catch (error) {
      logger.error(`[PlatformManager] Error updating localStorage for ${platform}:`, error);
      return false;
    }
  }

  /**
   * Verify platform connection with real-time API check and update localStorage
   * @param {string} platform - Platform to verify
   * @returns {Promise<boolean>} Whether platform is connected
   */
  async verifyPlatformConnectionRealtime(platform: string): Promise<boolean> {
    try {
      logger.info(`[PlatformManager] Starting real-time verification for ${platform}`);

      // Dispatch verification start event
      window.dispatchEvent(new CustomEvent('platform-verification-start', {
        detail: {
          platform,
          timestamp: Date.now()
        }
      }));

      // Step 1: Check API status
      const apiStatus = await this.checkPlatformStatusAPI(platform);

      if (apiStatus.status === 'error') {
        logger.warn(`[PlatformManager] API check failed for ${platform}, falling back to localStorage`);
        
        // Dispatch verification end event
        window.dispatchEvent(new CustomEvent('platform-verification-end', {
          detail: {
            platform,
            success: false,
            fallback: true,
            timestamp: Date.now()
          }
        }));
        
        // Fall back to localStorage status if API fails
        const authDataStr = localStorage.getItem('dailyfix_auth');
        if (authDataStr) {
          const authData = JSON.parse(authDataStr);
          const userId = authData?.user?.id;
          if (userId) {
            if (platform === 'whatsapp') {
              return isWhatsAppConnected(userId);
            } else if (platform === 'telegram') {
              return isTelegramConnected(userId);
            } else if (platform === 'instagram') {
              return isInstagramConnected(userId);
            } else if (platform === 'linkedin') {
              return isLinkedInConnected(userId);
            }
          }
        }
        return false;
      }

      // Step 2: Handle 'never_connected' status
      if (apiStatus.status === 'never_connected') {
        logger.info(`[PlatformManager] User has never connected to ${platform}`);
        
        // Dispatch never-connected event for UI to handle
        window.dispatchEvent(new CustomEvent('platform-never-connected', {
          detail: {
            platform,
            message: apiStatus.message,
            hasMatrixAccount: apiStatus.hasMatrixAccount,
            timestamp: Date.now()
          }
        }));
        
        // Update localStorage to reflect never-connected status
        this.updateLocalStorageFromAPI(platform, apiStatus);
        
        // Dispatch verification end event
        window.dispatchEvent(new CustomEvent('platform-verification-end', {
          detail: {
            platform,
            success: true,
            isActive: false,
            neverConnected: true,
            timestamp: Date.now()
          }
        }));
        
        return false;
      }

      // Step 3: Update localStorage based on API response
      const statusChanged = this.updateLocalStorageFromAPI(platform, apiStatus);

      // Step 4: Dispatch event if status changed
      if (statusChanged) {
        logger.info(`[PlatformManager] ${platform} connection status changed, dispatching event`);
        window.dispatchEvent(new CustomEvent('platform-connection-changed', {
          detail: {
            platform,
            isActive: apiStatus.status === 'active',
            status: apiStatus.status,
            hasMatrixAccount: apiStatus.hasMatrixAccount,
            phoneNumber: apiStatus.phoneNumber,
            timestamp: Date.now(),
            source: 'api-verification'
          }
        }));
      }

      // Dispatch verification end event
      window.dispatchEvent(new CustomEvent('platform-verification-end', {
        detail: {
          platform,
          success: true,
          isActive: apiStatus.status === 'active',
          status: apiStatus.status,
          hasMatrixAccount: apiStatus.hasMatrixAccount,
          timestamp: Date.now()
        }
      }));

      return apiStatus.status === 'active';
    } catch (error) {
      logger.error(`[PlatformManager] Error in real-time verification for ${platform}:`, error);
      
      // Dispatch verification end event on error
      window.dispatchEvent(new CustomEvent('platform-verification-end', {
        detail: {
          platform,
          success: false,
          error: error.message,
          timestamp: Date.now()
        }
      }));
      
      return false;
    }
  }

  /**
   * Get all currently active/connected platforms with real-time API verification
   * @param {boolean} [verifiedOnly=false] - Whether to only include verified connections
   * @param {boolean} [forceApiCheck=false] - Whether to force API check regardless of cooldown
   * @returns {Promise<string[]>} Array of active platform names
   */
  async getAllActivePlatformsRealtime(verifiedOnly: boolean = false, forceApiCheck: boolean = false): Promise<string[]> {
    const activePlatforms: string[] = [];
    
    try {
      const authDataStr = localStorage.getItem('dailyfix_auth');
      if (!authDataStr) {
        logger.warn('[PlatformManager] No auth data found for platform check');
        return activePlatforms;
      }

      const authData = JSON.parse(authDataStr);
      const userId = authData.user?.id;
      if (!userId) {
        logger.warn('[PlatformManager] No user ID found for platform check');
        return activePlatforms;
      }

      // Check each platform with API verification
      for (const platform of this.availablePlatforms) {
        try {
          // Force API check if requested or use cached/localStorage data
          if (forceApiCheck) {
            const isConnected = await this.verifyPlatformConnectionRealtime(platform);
            if (isConnected) {
              activePlatforms.push(platform);
            }
          } else {
            // Use localStorage with verification flag check if requested
            let isConnected = false;
            
            if (platform === 'whatsapp') {
              if (verifiedOnly) {
                const status = getWhatsAppConnectionStatus(userId);
                isConnected = status?.isConnected && status?.verified;
              } else {
                isConnected = isWhatsAppConnected(userId);
              }
            } else if (platform === 'telegram') {
              if (verifiedOnly) {
                const status = getTelegramConnectionStatus(userId);
                isConnected = status?.isConnected && status?.verified;
              } else {
                isConnected = isTelegramConnected(userId);
              }
            } else if (platform === 'instagram') {
              if (verifiedOnly) {
                const status = getInstagramConnectionStatus(userId);
                isConnected = status?.isConnected && status?.verified;
              } else {
                isConnected = isInstagramConnected(userId);
              }
            } else if (platform === 'linkedin') {
              isConnected = isLinkedInConnected(userId);
            }

            if (isConnected) {
              activePlatforms.push(platform);
            }
          }
        } catch (error) {
          logger.error(`[PlatformManager] Error checking ${platform} status:`, error);
        }
      }
    } catch (error) {
      logger.error('[PlatformManager] Error getting active platforms:', error);
    }
    
    logger.info(`[PlatformManager] Active platforms ${forceApiCheck ? '(API-verified)' : '(localStorage)'}: ${activePlatforms.join(', ')}`);
    return activePlatforms;
  }

  /**
   * Switch to a different platform
   * @param {string} platform - Platform to switch to
   * @param {Object} options - Additional options for platform initialization
   * @returns {Promise<boolean>} Success status
   */
  async switchPlatform(platform: string, options: any = {}): Promise<boolean> {
    if (!platform) {
      logger.error('[PlatformManager] Cannot switch to undefined platform');
      return false;
    }

    logger.info(`[PlatformManager] Switching platform from ${this.activePlatform || 'none'} to ${platform}`);

    // Verify platform is actually connected via API before switching
    const isConnected = await this.verifyPlatformConnectionRealtime(platform);
    if (!isConnected) {
      logger.error(`[PlatformManager] Cannot switch to ${platform} - not connected according to API`);
      return false;
    }

    // If we're already on this platform, just return success
    if (this.activePlatform === platform) {
      logger.info(`[PlatformManager] Already on platform ${platform}`);
      return true;
    }

    try {
      // 1. Clean up current platform if any
      if (this.activePlatform) {
        await this.cleanupPlatform(this.activePlatform);
      }

      // 2. Initialize new platform
      const success = await this.initializePlatform(platform, options);
      if (success) {
        this.activePlatform = platform;
        logger.info(`[PlatformManager] Successfully switched to platform ${platform}`);
        return true;
      } else {
        logger.error(`[PlatformManager] Failed to initialize platform ${platform}`);
        return false;
      }
    } catch (error) {
      logger.error(`[PlatformManager] Error switching to platform ${platform}:`, error);
      return false;
    }
  }

  /**
   * Initialize a specific platform
   * @param {string} platform - Platform to initialize
   * @param {Object} options - Additional options for platform initialization
   * @returns {Promise<boolean>} Success status
   */
  async initializePlatform(platform: string, options: any = {}): Promise<boolean> {
    try {
      logger.info(`[PlatformManager] Initializing platform ${platform}`);

      // Check if we have an initializer for this platform
      const initializer = this.platformInitializers[platform];
      if (!initializer) {
        logger.error(`[PlatformManager] No initializer found for platform ${platform}`);
        return false;
      }

      // Call platform-specific initializer
      const success = await initializer(options);

      // Save platform state
      this.platformStates.set(platform, {
        active: success,
        lastInitialized: new Date(),
        options
      });

      return success;
    } catch (error) {
      logger.error(`[PlatformManager] Error initializing platform ${platform}:`, error);
      return false;
    }
  }

  /**
   * Clean up a specific platform
   * @param {string} platform - Platform to clean up
   * @returns {Promise<boolean>} Success status
   */
  async cleanupPlatform(platform: string): Promise<boolean> {
    try {
      logger.info(`[PlatformManager] Cleaning up platform ${platform}`);

      // Check if we have a cleanup handler for this platform
      const cleanupHandler = this.platformCleanupHandlers[platform];
      if (!cleanupHandler) {
        logger.warn(`[PlatformManager] No cleanup handler found for platform ${platform}`);
        return false;
      }

      // Call platform-specific cleanup handler
      const success = await cleanupHandler();

      // Update platform state
      if (this.platformStates.has(platform)) {
        const state = this.platformStates.get(platform)!;
        this.platformStates.set(platform, {
          ...state,
          active: false,
          lastCleanup: new Date()
        });
      }

      return success;
    } catch (error) {
      logger.error(`[PlatformManager] Error cleaning up platform ${platform}:`, error);
      return false;
    }
  }

  /**
   * Initialize Telegram platform
   * @param {Object} options - Telegram initialization options
   * @returns {Promise<boolean>} Success status
   */
  // async initializeTelegram(options: any = {}): Promise<boolean> {
  //   try {
  //     logger.info('[PlatformManager] Initializing Telegram platform');

  //     // Try to get Matrix client from window object
  //     let client = window.matrixClient;

  //     // If not available, check if we need to initialize it
  //     if (!client) {
  //       logger.warn('[PlatformManager] Matrix client not available, checking if we can initialize it');

  //       // Check if we have Matrix credentials in localStorage
  //       const matrixCredentialsStr = localStorage.getItem('matrix_credentials');
  //       if (matrixCredentialsStr) {
  //         logger.info('[PlatformManager] Found Matrix credentials, attempting to initialize client');

  //         // Dispatch an event to trigger Matrix initialization
  //         const event = new CustomEvent('dailyfix-initialize-matrix', {
  //           detail: { forTelegram: true }
  //         });
  //         window.dispatchEvent(event);

  //         // Wait for Matrix client to be initialized (max 5 seconds)
  //         let attempts = 0;
  //         const MAX_ATTEMPTS = 10;
  //         const DELAY = 500; // 500ms

  //         while (!window.matrixClient && attempts < MAX_ATTEMPTS) {
  //           logger.info(`[PlatformManager] Waiting for Matrix client (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
  //           await new Promise(resolve => setTimeout(resolve, DELAY));
  //           attempts++;
  //         }

  //         client = window.matrixClient;
  //       }
  //     }

  //     // If still no client, show a more helpful error
  //     if (!client) {
  //       logger.error('[PlatformManager] Matrix client not available for Telegram initialization after waiting');
  //       // Show a toast notification to the user
  //       if (window.toast) {
  //         window.toast.error('Could not connect to Telegram. Please try refreshing the page.');
  //       }
  //       return false;
  //     }

  //     // Initialize room list with Telegram filter
  //     roomListManager.initRoomList(
  //       client.getUserId(),
  //       client,
  //       {
  //         filters: { platform: 'telegram' },
  //         sortBy: 'lastMessage'
  //       }
  //     );

  //     // We're no longer using sliding sync as it's causing disruptions
  //     // The sliding sync utility files are still available but we're not using them
  //     logger.info('[PlatformManager] Sliding sync disabled - using traditional sync methods instead');
      
  //     // Verify Telegram connection status with the server
  //     if (!options.skipVerification) {
  //       this.verifyTelegramConnection();
  //     }

  //     logger.info('[PlatformManager] Telegram platform initialized successfully');
  //     return true;
  //   } catch (error) {
  //     logger.error('[PlatformManager] Error initializing Telegram platform:', error);
  //     return false;
  //   }
  // }
  
  /**
   * Verify Telegram connection with the server (LEGACY - use verifyPlatformConnectionRealtime instead)
   * This ensures our local connection status matches the actual bridge status
   */
  async verifyTelegramConnection(): Promise<void> {
    return this.verifyPlatformConnectionRealtime('telegram').then(() => {});
  }

  /**
   * Initialize WhatsApp platform
   * @param {Object} options - WhatsApp initialization options
   * @returns {Promise<boolean>} Success status
   */
  async initializeWhatsApp(options: any = {}): Promise<boolean> {
    try {
      logger.info('[PlatformManager] Initializing WhatsApp platform');

      // Check if socket is already connected
      let socket = getSocket();

      // Actively initialize socket connection if not already connected
      if (!socket || !socket.connected) {
        logger.info('[PlatformManager] Socket not connected, initializing connection');

        // Try to initialize socket directly
        try {
          const { initializeSocket } = await import('../utils/socketManager');
          await initializeSocket();
          logger.info('[PlatformManager] Initialized socket directly');
        } catch (socketError) {
          logger.error('[PlatformManager] Error initializing socket directly:', socketError);
        }
      }
      
      // Verify WhatsApp connection status with the server
      if (!options.skipVerification) {
        this.verifyWhatsAppConnection();
      }

      logger.info('[PlatformManager] WhatsApp platform initialized successfully');
      return true;
    } catch (error) {
      logger.error('[PlatformManager] Error initializing WhatsApp platform:', error);
      return false;
    }
  }
  
  /**
   * Verify WhatsApp connection with the server (LEGACY - use verifyPlatformConnectionRealtime instead)
   * This ensures our local connection status matches the actual bridge status
   */
  async verifyWhatsAppConnection(): Promise<void> {
    return this.verifyPlatformConnectionRealtime('whatsapp').then(() => {});
  }

  /**
   * Clean up WhatsApp platform
   * @returns {Promise<boolean>} Success status
   */
  async cleanupWhatsApp(): Promise<boolean> {
    try {
      logger.info('[PlatformManager] Cleaning up WhatsApp platform');

      // We don't disconnect the socket here because it might be needed for other purposes
      // Instead, we just stop any active listeners or timers

      // Clear any WhatsApp-specific timers or intervals
      // (none currently identified)

      logger.info('[PlatformManager] WhatsApp platform cleaned up successfully');
      return true;
    } catch (error) {
      logger.error('[PlatformManager] Error cleaning up WhatsApp platform:', error);
      return false;
    }
  }

  /**
   * Get the currently active platform based on the most recently switched to platform
   * This may differ from actual connection status which should be checked with getAllActivePlatforms()
   * @returns {string|null} Active platform or null if none
   */
  getActivePlatform(): string | null {
    // First check if we have a currently set active platform
    if (this.activePlatform) {
      return this.activePlatform;
    }

    // Otherwise, check if we have any connected platforms based on localStorage
    const activePlatforms = this.getAllActivePlatforms();
    return activePlatforms.length > 0 ? activePlatforms[0] : null;
  }

  /**
   * Get all currently active/connected platforms based on localStorage (LEGACY)
   * @param {boolean} [verifiedOnly=false] - Whether to only include verified connections
   * @returns {string[]} Array of active platform names
   */
  getAllActivePlatforms(verifiedOnly: boolean = false): string[] {
    const activePlatforms: string[] = [];
    
    try {
      // Get the current user ID from localStorage to check connection status
      const authDataStr = localStorage.getItem('dailyfix_auth');
      if (authDataStr) {
        const authData = JSON.parse(authDataStr);
        const userId = authData.user?.id;
        
        if (userId) {
          // Check WhatsApp connection status with verification if requested
          if (verifiedOnly) {
            const whatsappStatus = getWhatsAppConnectionStatus(userId);
            if (whatsappStatus && whatsappStatus.isConnected && whatsappStatus.verified) {
              activePlatforms.push('whatsapp');
            }
          } else if (isWhatsAppConnected(userId)) {
            activePlatforms.push('whatsapp');
          }
          
          // Check Telegram connection status with verification if requested
          if (verifiedOnly) {
            const telegramStatus = getTelegramConnectionStatus(userId);
            if (telegramStatus && telegramStatus.isConnected && telegramStatus.verified) {
              activePlatforms.push('telegram');
            }
          } else if (isTelegramConnected(userId)) {
            activePlatforms.push('telegram');
          }
          
          // Check Instagram connection status with verification if requested
          if (verifiedOnly) {
            const instagramStatus = getInstagramConnectionStatus(userId);
            if (instagramStatus && instagramStatus.isConnected && instagramStatus.verified) {
              activePlatforms.push('instagram');
            }
          } else if (isInstagramConnected(userId)) {
            activePlatforms.push('instagram');
          }

          // Check LinkedIn connection status with verification if requested
          if (verifiedOnly) {
            const linkedInStatus = getLinkedInConnectionStatus(userId);
            if (linkedInStatus && linkedInStatus.isConnected && linkedInStatus.verified) {
              activePlatforms.push('linkedin');
            }
          } else if (isLinkedInConnected(userId)) {
            activePlatforms.push('linkedin');
          }
        }
      }
    } catch (error) {
      logger.error('[PlatformManager] Error getting active platforms:', error);
    }
    
    return activePlatforms;
  }

  /**
   * Check if a platform is active based on actual connection status
   * @param {string} platform - Platform to check
   * @param {boolean} [verifiedOnly=false] - Whether to only consider verified connections
   * @returns {boolean} Whether the platform is active
   */
  isPlatformActive(platform: string, verifiedOnly: boolean = false): boolean {
    // First check our internal state
    if (this.activePlatform === platform) {
      return true;
    }
    
    // Then check localStorage-based connection status with verification if requested
    return this.getAllActivePlatforms(verifiedOnly).includes(platform);
  }

  /**
   * Check if WhatsApp connection is verified
   * @returns {boolean} Whether WhatsApp connection is verified
   */
  isWhatsAppVerified(): boolean {
    try {
      const authDataStr = localStorage.getItem('dailyfix_auth');
      if (authDataStr) {
        const authData = JSON.parse(authDataStr);
        const userId = authData.user?.id;
        
        if (userId) {
          const detailedStatus = getWhatsAppConnectionStatus(userId);
          return detailedStatus ? detailedStatus.verified : false;
        }
      }
      return false;
    } catch (error) {
      logger.error('[PlatformManager] Error checking WhatsApp verification:', error);
      return false;
    }
  }

  /**
   * Check if Telegram connection is verified
   * @returns {boolean} Whether Telegram connection is verified
   */
  isTelegramVerified(): boolean {
    try {
      const authDataStr = localStorage.getItem('dailyfix_auth');
      if (authDataStr) {
        const authData = JSON.parse(authDataStr);
        const userId = authData.user?.id;
        
        if (userId) {
          const detailedStatus = getTelegramConnectionStatus(userId);
          return detailedStatus ? detailedStatus.verified : false;
        }
      }
      return false;
    } catch (error) {
      logger.error('[PlatformManager] Error checking Telegram verification:', error);
      return false;
    }
  }

  /**
   * Check if user has never connected to any platforms
   * @returns {Promise<{hasNeverConnected: boolean, platforms: string[]}>} Whether user has never connected and which platforms
   */
  async checkForNeverConnectedPlatforms(): Promise<{hasNeverConnected: boolean, platforms: string[]}> {
    // CRITICAL FIX: Prevent multiple simultaneous checks
    if (this.isCheckingNeverConnected) {
      logger.info('[PlatformManager] Never-connected check already in progress, skipping');
      return {
        hasNeverConnected: false,
        platforms: []
      };
    }

    const neverConnectedPlatforms: string[] = [];
    
    try {
      this.isCheckingNeverConnected = true;
      logger.info('[PlatformManager] Checking for never-connected platforms');
      
      // Check each platform
      for (const platform of this.availablePlatforms) {
        try {
          const apiStatus = await this.checkPlatformStatusAPI(platform);
          
          if (apiStatus.status === 'never_connected') {
            neverConnectedPlatforms.push(platform);
            logger.info(`[PlatformManager] ${platform} has never been connected`);
          }
        } catch (error) {
          logger.warn(`[PlatformManager] Could not check ${platform} status for never-connected check:`, error);
          // If API fails, we can't determine never-connected status, so skip
        }
      }
      
      const hasNeverConnected = neverConnectedPlatforms.length === this.availablePlatforms.length;
      
      logger.info(`[PlatformManager] Never-connected check result:`, {
        hasNeverConnected,
        neverConnectedPlatforms,
        totalPlatforms: this.availablePlatforms.length
      });
      
      return {
        hasNeverConnected,
        platforms: neverConnectedPlatforms
      };
    } catch (error) {
      logger.error('[PlatformManager] Error checking for never-connected platforms:', error);
      return {
        hasNeverConnected: false,
        platforms: []
      };
    } finally {
      // CRITICAL FIX: Always reset the flag
      this.isCheckingNeverConnected = false;
    }
  }

  /**
   * Refresh all platform connection statuses with API verification
   * @returns {Promise<string[]>} Array of active platform names after refresh
   */
  async refreshAllPlatformStatuses(): Promise<string[]> {
    logger.info('[PlatformManager] Refreshing all platform connection statuses with API verification');
    
    try {
      // Force API check for all platforms
      const activePlatforms = await this.getAllActivePlatformsRealtime(false, true);
      
      logger.info(`[PlatformManager] Platform status refresh complete. Active platforms: ${activePlatforms.join(', ')}`);
      
      // Dispatch global event to notify all components
      window.dispatchEvent(new CustomEvent('platform-connection-changed', {
        detail: {
          platform: 'all',
          activePlatforms,
          timestamp: Date.now(),
          source: 'refresh-all'
        }
      }));
      
      return activePlatforms;
    } catch (error) {
      logger.error('[PlatformManager] Error refreshing platform statuses:', error);
      return [];
    }
  }
}

// Create singleton instance
const platformManager = new PlatformManager();

export default platformManager;
