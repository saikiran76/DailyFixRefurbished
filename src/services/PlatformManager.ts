import logger from '../utils/logger';
import roomListManager from '../utils/roomListManager';
// import slidingSyncManager from '../utils/SlidingSyncManager';
import { getSocket, disconnectSocket } from '../utils/socketManager';
import { 
  isWhatsAppConnected,
  getWhatsAppConnectionStatus,
  isTelegramConnected,
  getTelegramConnectionStatus,
  saveTelegramConnectionStatus,
  saveWhatsAppConnectionStatus
} from '../utils/connectionStorage';

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
 * PlatformManager service
 * Handles platform-specific initialization, cleanup, and switching
 */
class PlatformManager {
  private activePlatform: string | null = null;
  public availablePlatforms: string[] = ['whatsapp', 'telegram'];
  private platformStates: Map<string, PlatformState> = new Map();
  private platformInitializers: { [key: string]: (options?: any) => Promise<boolean> } = {};
  private platformCleanupHandlers: { [key: string]: () => Promise<boolean> } = {};
  private isCheckingStatus: boolean = false;
  private isVerifyingConnection: boolean = false;

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
      
      // Verify Telegram connection status with the server
      if (!options.skipVerification) {
        this.verifyTelegramConnection();
      }

      logger.info('[PlatformManager] Telegram platform initialized successfully');
      return true;
    } catch (error) {
      logger.error('[PlatformManager] Error initializing Telegram platform:', error);
      return false;
    }
  }
  
  /**
   * Verify Telegram connection with the server
   * This ensures our local connection status matches the actual bridge status
   */
  async verifyTelegramConnection(): Promise<void> {
    try {
      if (this.isVerifyingConnection) {
        logger.info('[PlatformManager] Telegram verification already in progress, skipping');
        return;
      }
      
      this.setVerifyingConnection(true);
      logger.info('[PlatformManager] Verifying Telegram connection status with server');
      
      // Get the current user ID from localStorage
      const authDataStr = localStorage.getItem('dailyfix_auth');
      if (!authDataStr) {
        logger.warn('[PlatformManager] No auth data found for Telegram verification');
        this.setVerifyingConnection(false);
        return;
      }
      
      const authData = JSON.parse(authDataStr);
      const userId = authData?.user?.id;
      if (!userId) {
        logger.warn('[PlatformManager] No user ID found for Telegram verification');
        this.setVerifyingConnection(false);
        return;
      }
      
      // Check with the API if Telegram is actually connected
      const response = await fetch('/api/v1/matrix/telegram/status', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Error verifying Telegram: ${response.statusText}`);
      }
      
      const data = await response.json();
      logger.info('[PlatformManager] Telegram verification response:', data);
      
      // Get current local status
      const currentStatus = getTelegramConnectionStatus(userId);
      
      // Update local status based on server response
      const isConnected = data.status === 'active';
      const isVerified = true; // We've now verified the status with the server
      
      // Update local connection status
      saveTelegramConnectionStatus(userId, {
        isConnected,
        verified: isVerified,
        lastVerified: Date.now(),
        verificationAttempts: 0
      });
      
      logger.info(`[PlatformManager] Telegram verification complete: connected=${isConnected}, verified=${isVerified}`);
      
      // If status changed, dispatch event to notify components
      if (currentStatus?.isConnected !== isConnected) {
        window.dispatchEvent(new CustomEvent('platform-connection-changed'));
        
        // Show toast if disconnected
        if (!isConnected && currentStatus?.isConnected) {
          if (window.toast) {
            window.toast.error('Telegram connection lost. Please reconnect in settings.');
          }
        }
      }
    } catch (error) {
      logger.error('[PlatformManager] Error verifying Telegram connection:', error);
    } finally {
      this.setVerifyingConnection(false);
    }
  }

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
   * Verify WhatsApp connection with the server
   * This ensures our local connection status matches the actual bridge status
   */
  async verifyWhatsAppConnection(): Promise<void> {
    try {
      if (this.isVerifyingConnection) {
        logger.info('[PlatformManager] WhatsApp verification already in progress, skipping');
        return;
      }
      
      this.setVerifyingConnection(true);
      logger.info('[PlatformManager] Verifying WhatsApp connection status with server');
      
      // Get the current user ID from localStorage
      const authDataStr = localStorage.getItem('dailyfix_auth');
      if (!authDataStr) {
        logger.warn('[PlatformManager] No auth data found for WhatsApp verification');
        this.setVerifyingConnection(false);
        return;
      }
      
      const authData = JSON.parse(authDataStr);
      const userId = authData?.user?.id;
      if (!userId) {
        logger.warn('[PlatformManager] No user ID found for WhatsApp verification');
        this.setVerifyingConnection(false);
        return;
      }
      
      // Check with the API if WhatsApp is actually connected
      const response = await fetch('/api/v1/matrix/whatsapp/status', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Error verifying WhatsApp: ${response.statusText}`);
      }
      
      const data = await response.json();
      logger.info('[PlatformManager] WhatsApp verification response:', data);
      
      // Get current local status
      const currentStatus = getWhatsAppConnectionStatus(userId);
      
      // Update local status based on server response
      const isConnected = data.status === 'active';
      const isVerified = true; // We've now verified the status with the server
      
      // Update local connection status
      saveWhatsAppConnectionStatus(userId, {
        isConnected,
        verified: isVerified,
        lastVerified: Date.now(),
        verificationAttempts: 0
      });
      
      logger.info(`[PlatformManager] WhatsApp verification complete: connected=${isConnected}, verified=${isVerified}`);
      
      // If status changed, dispatch event to notify components
      if (currentStatus?.isConnected !== isConnected) {
        window.dispatchEvent(new CustomEvent('platform-connection-changed'));
        
        // Show toast if disconnected
        if (!isConnected && currentStatus?.isConnected) {
          if (window.toast) {
            window.toast.error('WhatsApp connection lost. Please reconnect in settings.');
          }
        }
      }
    } catch (error) {
      logger.error('[PlatformManager] Error verifying WhatsApp connection:', error);
    } finally {
      this.setVerifyingConnection(false);
    }
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
   * Get all currently active/connected platforms based on actual connection status
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
}

// Create singleton instance
const platformManager = new PlatformManager();

export default platformManager;
