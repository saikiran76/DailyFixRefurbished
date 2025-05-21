import logger from '../utils/logger';
import roomListManager from '../utils/roomListManager';
// import slidingSyncManager from '../utils/SlidingSyncManager';
import { getSocket, disconnectSocket } from '../utils/socketManager';

/**
 * PlatformManager service
 * Handles platform-specific initialization, cleanup, and switching
 */
class PlatformManager {
  private activePlatform: string | null = null;
  private platformStates: Map<string, { active: boolean, lastInitialized: Date, options: any }> = new Map();
  private platformInitializers: { [key: string]: () => Promise<boolean> } = {};
  private platformCleanupHandlers: { [key: string]: () => Promise<boolean> } = {};

  constructor() {
    this.activePlatform = null;
    this.platformStates = new Map();
    this.platformInitializers = {
      'telegram': this.initializeTelegram.bind(this),
      'whatsapp': this.initializeWhatsApp.bind(this)
    };
    this.platformCleanupHandlers = {
      'telegram': this.cleanupTelegram.bind(this),
      'whatsapp': this.cleanupWhatsApp.bind(this)
    };

    logger.info('[PlatformManager] Service initialized');
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
        const state = this.platformStates.get(platform);
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
  async initializeTelegram(options: any = {}): Promise<boolean> {
    try {
      logger.info('[PlatformManager] Initializing Telegram platform');

      // Try to get Matrix client from window object
      let client = window.matrixClient;

      // If not available, check if we need to initialize it
      if (!client) {
        logger.warn('[PlatformManager] Matrix client not available, checking if we can initialize it');

        // Check if we have Matrix credentials in localStorage
        const matrixCredentialsStr = localStorage.getItem('matrix_credentials');
        if (matrixCredentialsStr) {
          logger.info('[PlatformManager] Found Matrix credentials, attempting to initialize client');

          // Dispatch an event to trigger Matrix initialization
          const event = new CustomEvent('dailyfix-initialize-matrix', {
            detail: { forTelegram: true }
          });
          window.dispatchEvent(event);

          // Wait for Matrix client to be initialized (max 5 seconds)
          let attempts = 0;
          const MAX_ATTEMPTS = 10;
          const DELAY = 500; // 500ms

          while (!window.matrixClient && attempts < MAX_ATTEMPTS) {
            logger.info(`[PlatformManager] Waiting for Matrix client (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
            await new Promise(resolve => setTimeout(resolve, DELAY));
            attempts++;
          }

          client = window.matrixClient;
        }
      }

      // If still no client, show a more helpful error
      if (!client) {
        logger.error('[PlatformManager] Matrix client not available for Telegram initialization after waiting');
        // Show a toast notification to the user
        if (window.toast) {
          window.toast.error('Could not connect to Telegram. Please try refreshing the page.');
        }
        return false;
      }

      // Initialize room list with Telegram filter
      roomListManager.initRoomList(
        client.getUserId(),
        client,
        {
          filters: { platform: 'telegram' },
          sortBy: 'lastMessage'
        }
      );

      // We're no longer using sliding sync as it's causing disruptions
      // The sliding sync utility files are still available but we're not using them
      logger.info('[PlatformManager] Sliding sync disabled - using traditional sync methods instead');

      logger.info('[PlatformManager] Telegram platform initialized successfully');
      return true;
    } catch (error) {
      logger.error('[PlatformManager] Error initializing Telegram platform:', error);
      return false;
    }
  }

  /**
   * Clean up Telegram platform
   * @returns {Promise<boolean>} Success status
   */
  /**
 * Clean up Telegram platform
 * @returns {Promise<boolean>} Success status
 */
  async cleanupTelegram(): Promise<boolean> {
    try {
      logger.info('[PlatformManager] Cleaning up Telegram platform');

      // Stop sliding sync if it's running
      // if (slidingSyncManager && slidingSyncManager.initialized) {
      //   slidingSyncManager.stopSyncLoop();
      // }

      // Clear Telegram connection flags from sessionStorage
      sessionStorage.removeItem('connecting_to_telegram');
      sessionStorage.removeItem('telegram_connection_step');
      sessionStorage.removeItem('telegram_phone_number');

      // Clean up Matrix client if it exists
      if (window.matrixClient) {
        try {
          logger.info('[PlatformManager] Cleaning up Matrix client resources');

          // Remove all listeners to prevent memory leaks
          window.matrixClient.removeAllListeners();

          // Don't stop the client completely as it might be needed later
          // Just pause syncing to reduce resource usage
          if (window.matrixClient.clientRunning) {
            window.matrixClient.pauseClient();
          }

          // Clear room list manager for this user
          if (window.matrixClient.getUserId()) {
            roomListManager.cleanup(window.matrixClient.getUserId());
          }
        } catch (matrixError) {
          logger.error('[PlatformManager] Error cleaning up Matrix client:', matrixError);
          // Continue with cleanup even if there's an error
        }
      }

      logger.info('[PlatformManager] Telegram platform cleaned up successfully');
      return true;
    } catch (error) {
      logger.error('[PlatformManager] Error cleaning up Telegram platform:', error);
      return false;
    }
  }

  /**
   * Initialize WhatsApp platform
   * @param {Object} options - WhatsApp initialization options
   * @returns {Promise<boolean>} Success status
   */
  /**
 * Initialize WhatsApp platform
 * @param {Object} options - WhatsApp initialization options
 * @returns {Promise<boolean>} Success status
 */
  async initializeWhatsApp(options = {}) {
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

      logger.info('[PlatformManager] WhatsApp platform initialized successfully');
      return true;
    } catch (error) {
      logger.error('[PlatformManager] Error initializing WhatsApp platform:', error);
      return false;
    }
  }

  /**
   * Clean up WhatsApp platform
   * @returns {Promise<boolean>} Success status
   */
  async cleanupWhatsApp() {
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
   * Get the currently active platform
   * @returns {string|null} Active platform or null if none
   */
  getActivePlatform() {
    return this.activePlatform;
  }

  /**
   * Check if a platform is active
   * @param {string} platform - Platform to check
   * @returns {boolean} Whether the platform is active
   */
  isPlatformActive(platform) {
    return this.activePlatform === platform;
  }
}

// Create singleton instance
const platformManager = new PlatformManager();

export default platformManager;
