import { supabase } from '../utils/supabase';
import { tokenManager } from '../utils/tokenManager';
import { socketHealthMonitor } from './SocketHealthMonitor';
import { tokenValidationService } from './TokenValidationService';
import { syncQueueManager } from './SyncQueueManager';
import { executeAtomically } from '../utils/atomicOperations';
import logger from '../utils/logger';
import api from '../utils/api';

const SYNC_STATES = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  ERROR: 'error',
  SUCCESS: 'success'
};

const SYNC_TYPES = {
  CONTACTS: 'contacts',
  MESSAGES: 'messages',
  FULL: 'full'
};

const MAX_BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

class SyncService {
  constructor() {
    this.syncState = {
      contacts: SYNC_STATES.IDLE,
      messages: SYNC_STATES.IDLE
    };
    this.syncProgress = {
      contacts: 0,
      messages: 0
    };
    this.activeSyncs = new Map(); // userId -> { type, promise, cancel }
    this.syncErrors = new Map(); // userId -> { type, error, timestamp }
    this.lastSyncTime = new Map(); // userId -> { type, timestamp }
    this.healthCheckUnsubscribe = null;
    this.initialize();
  }

  initialize() {
    // Start socket health monitoring
    socketHealthMonitor.startMonitoring();
    
    // Listen for health changes
    this.healthCheckUnsubscribe = socketHealthMonitor.onHealthChange(status => {
      if (!status.healthy) {
        logger.warn('[Sync] Socket unhealthy, pausing active syncs');
        this.pauseActiveSyncs();
      } else {
        logger.info('[Sync] Socket healthy, resuming paused syncs');
        this.resumePausedSyncs();
      }
    });
  }

  async checkSocketHealth() {
    const status = socketHealthMonitor.getStatus();
    if (!status.healthy) {
      throw new Error('Socket connection unhealthy');
    }
  }

  pauseActiveSyncs() {
    for (const [userId, sync] of this.activeSyncs) {
      sync.pause?.();
    }
  }

  async resumePausedSyncs() {
    for (const [userId, sync] of this.activeSyncs) {
      if (sync.paused) {
        await sync.resume?.();
      }
    }
  }

  async startSync(userId, type = SYNC_TYPES.FULL) {
    if (!userId) {
      logger.info('[Sync] No user ID provided');
      return null;
    }

    await this.checkSocketHealth();

    try {
      // Queue the sync operation
      return await syncQueueManager.queueSync(userId, type, async () => {
        // Initialize sync state
        this.syncState[type] = SYNC_STATES.SYNCING;
        this.syncProgress[type] = 0;

        try {
          const result = await this._executeSyncWithRetry(userId, type);
          
          // Update last sync time on success
          this.lastSyncTime.set(userId, {
            type,
            timestamp: Date.now()
          });

          this.syncState[type] = SYNC_STATES.SUCCESS;
          return result;
        } catch (error) {
          this.syncState[type] = SYNC_STATES.ERROR;
          this.syncErrors.set(userId, {
            type,
            error,
            timestamp: Date.now()
          });
          throw error;
        }
      }, {
        priority: type === SYNC_TYPES.FULL ? 'HIGH' : 'MEDIUM'
      });
    } catch (error) {
      logger.info('[Sync] Error starting sync:', error);
      throw error;
    }
  }

  async _executeSyncWithRetry(userId, type, attempt = 1) {
    try {
      await this.checkSocketHealth();

      switch (type) {
        case SYNC_TYPES.CONTACTS:
          return await this._syncContacts(userId);
        case SYNC_TYPES.MESSAGES:
          return await this._syncMessages(userId);
        case SYNC_TYPES.FULL:
          await this._syncContacts(userId);
          return await this._syncMessages(userId);
        default:
          throw new Error(`Invalid sync type: ${type}`);
      }
    } catch (error) {
      const queueStatus = syncQueueManager.getQueueStatus(userId);
      if (!queueStatus.activeSync) {
        logger.warn(`[Sync] Sync cancelled or queue cleared for ${type}`);
        throw new Error('Sync cancelled');
      }

      if (attempt < MAX_RETRIES) {
        logger.warn(`[Sync] Retry ${attempt}/${MAX_RETRIES} for ${type} sync:`, error);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, attempt - 1)));
        return this._executeSyncWithRetry(userId, type, attempt + 1);
      }

      throw error;
    }
  }

  async _validateAndRefreshToken(userId) {
    try {
      const token = await tokenValidationService.ensureValidToken(userId);
      if (!token) {
        throw new Error('Failed to obtain valid token');
      }
      return token;
    } catch (error) {
      logger.info('[Sync] Token validation failed:', error);
      throw error;
    }
  }

  async _processBatch(userId, type, items) {
    try {
      // Ensure valid token before processing batch
      const token = await this._validateAndRefreshToken(userId);
      
      const { data, error } = await supabase
        .from(type)
        .upsert(
          items.map(item => ({
            ...item,
            user_id: userId,
            updated_at: new Date().toISOString()
          }))
        );

      if (error) {
        if (error.message?.includes('JWT')) {
          // Token might have expired during batch processing
          const newToken = await this._validateAndRefreshToken(userId);
          if (!newToken) throw new Error('Token refresh failed during batch processing');
          
          // Retry batch with new token
          return this._processBatch(userId, type, items);
        }
        throw error;
      }

      return data;
    } catch (error) {
      logger.info(`[Sync] Error processing ${type} batch:`, error);
      throw error;
    }
  }

  async _syncContacts(userId) {
    logger.info('[Sync] Starting contact sync for user:', userId);
    
    try {
      // Validate token before starting sync
      await this._validateAndRefreshToken(userId);
      
      // Get WhatsApp contacts
      const { data: whatsappContacts } = await api.get('/whatsapp/contacts');

      // Process contacts in batches
      const batches = this._createBatches(whatsappContacts, MAX_BATCH_SIZE);
      const total = whatsappContacts.length;
      let processed = 0;

      for (const batch of batches) {
        // Update contacts in database
        await this._processBatch(userId, 'contacts', batch);
        
        processed += batch.length;
        this.syncProgress.contacts = Math.round((processed / total) * 100);
      }

      logger.info('[Sync] Contact sync completed for user:', userId);
      return { synced: processed };
    } catch (error) {
      logger.info('[Sync] Contact sync error:', error);
      throw error;
    }
  }

  async _syncMessages(userId) {
    logger.info('[Sync] Starting message sync for user:', userId);
    
    try {
      // Validate token before starting sync
      await this._validateAndRefreshToken(userId);
      
      // Get last sync timestamp
      const lastSync = await this._getLastMessageSync(userId);
      
      // Get messages since last sync
      const { data: messages } = await api.get(`/api/v1/whatsapp/contacts/${userId}/messages`, {
        params: { since: lastSync }
      });

      if (!messages?.data) {
        throw new Error('No messages received from server');
      }

      // Process messages in batches
      const batches = this._createBatches(messages.data, MAX_BATCH_SIZE);
      const total = messages.data.length;
      let processed = 0;

      for (const batch of batches) {
        // Update messages in database
        await this._processBatch(userId, 'messages', batch);
        
        processed += batch.length;
        this.syncProgress.messages = Math.round((processed / total) * 100);

        // Emit progress update
        this._emitSyncProgress('messages', this.syncProgress.messages);
      }

      // Update last sync time
      await this._updateLastMessageSync(userId);

      logger.info('[Sync] Message sync completed for user:', userId);
      return { synced: processed };
    } catch (error) {
      logger.error('[Sync] Message sync error:', error);
      throw error;
    }
  }

  async _getLastMessageSync(userId) {
    try {
      const { data } = await supabase
        .from('sync_status')
        .select('last_message_sync')
        .eq('user_id', userId)
        .single();

      return data?.last_message_sync || new Date(0).toISOString();
    } catch (error) {
      logger.info('[Sync] Error getting last message sync:', error);
      return new Date(0).toISOString();
    }
  }

  async _updateLastMessageSync(userId) {
    try {
      await supabase
        .from('sync_status')
        .upsert({
          user_id: userId,
          last_message_sync: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
    } catch (error) {
      logger.info('[Sync] Error updating last message sync:', error);
      throw error;
    }
  }

  _createBatches(items, size) {
    const batches = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }

  cancelSync(userId) {
    syncQueueManager.clearQueue(userId);
    this.clearSyncState(userId);
  }

  pauseSync(userId) {
    syncQueueManager.pauseQueue(userId);
  }

  resumeSync(userId) {
    syncQueueManager.resumeQueue(userId);
  }

  getSyncStatus(userId) {
    const queueStatus = syncQueueManager.getQueueStatus(userId);
    return {
      ...this.getSyncState(userId),
      queueLength: queueStatus.queueLength,
      activeSync: queueStatus.activeSync
    };
  }

  getSyncState(userId, type) {
    return {
      state: this.syncState[type],
      progress: this.syncProgress[type],
      lastSync: this.lastSyncTime.get(userId),
      error: this.syncErrors.get(userId)
    };
  }

  clearSyncState(userId) {
    this.cancelSync(userId);
    this.syncErrors.delete(userId);
    this.lastSyncTime.delete(userId);
    this.syncState = {
      contacts: SYNC_STATES.IDLE,
      messages: SYNC_STATES.IDLE
    };
    this.syncProgress = {
      contacts: 0,
      messages: 0
    };
  }

  destroy() {
    if (this.healthCheckUnsubscribe) {
      this.healthCheckUnsubscribe();
    }
    socketHealthMonitor.stopMonitoring();
  }
}

export const syncService = new SyncService(); 