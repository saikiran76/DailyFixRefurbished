import { toast } from 'react-hot-toast';

export const SYNC_STATES = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  APPROVED: 'approved',
  REJECTED: 'rejected'
};

export const SYNC_MESSAGES = {
  [SYNC_STATES.IDLE]: 'Ready to sync',
  [SYNC_STATES.SYNCING]: 'Syncing in progress...',
  [SYNC_STATES.APPROVED]: 'Sync completed successfully',
  [SYNC_STATES.REJECTED]: 'Sync failed'
};

export class RetryManager {
  constructor(maxRetries = 3, baseDelay = 1000) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
    this.retryMap = new Map();
  }

  async withRetry(key, operation) {
    const retryCount = this.retryMap.get(key) || 0;
    
    if (retryCount >= this.maxRetries) {
      this.retryMap.delete(key);
      throw new Error(`Max retries reached for ${key}`);
    }
    
    try {
      const result = await operation();
      this.retryMap.delete(key);
      return result;
    } catch (error) {
      this.retryMap.set(key, retryCount + 1);
      const delay = Math.min(this.baseDelay * Math.pow(2, retryCount), 5000);
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.withRetry(key, operation);
    }
  }

  reset(key) {
    this.retryMap.delete(key);
  }

  resetAll() {
    this.retryMap.clear();
  }
}

export class SyncStateManager {
  constructor(onStateChange) {
    this.onStateChange = onStateChange;
    this.currentState = {
      state: SYNC_STATES.IDLE,
      progress: 0,
      details: SYNC_MESSAGES[SYNC_STATES.IDLE],
      errors: []
    };
  }

  update(updates) {
    this.currentState = {
      ...this.currentState,
      ...updates,
      timestamp: Date.now()
    };
    this.onStateChange(this.currentState);
  }

  updateProgress(progress, details) {
    this.update({
      progress,
      details: details || `Syncing (${Math.round(progress)}%)`
    });
  }

  setError(error) {
    this.update({
      state: SYNC_STATES.REJECTED,
      errors: [...this.currentState.errors, {
        message: error.message || String(error),
        timestamp: Date.now()
      }]
    });
    toast.error(`Sync failed: ${error.message || 'Unknown error'}`);
  }

  reset() {
    this.update({
      state: SYNC_STATES.IDLE,
      progress: 0,
      details: SYNC_MESSAGES[SYNC_STATES.IDLE],
      errors: []
    });
  }

  isInProgress() {
    return this.currentState.state === SYNC_STATES.SYNCING;
  }
}

export class SocketEventManager {
  constructor(socket, handlers) {
    this.socket = socket;
    this.handlers = handlers;
    this.boundHandlers = new Map();
  }

  subscribe() {
    if (!this.socket) return;

    Object.entries(this.handlers).forEach(([event, handler]) => {
      const boundHandler = (...args) => handler(...args);
      this.boundHandlers.set(event, boundHandler);
      this.socket.on(event, boundHandler);
    });
  }

  unsubscribe() {
    if (!this.socket) return;

    this.boundHandlers.forEach((handler, event) => {
      this.socket.off(event, handler);
    });
    this.boundHandlers.clear();
  }
}

export const createSyncHandlers = (syncStateManager, onComplete) => ({
  'whatsapp:sync_progress': (data) => {
    syncStateManager.updateProgress(data.progress, data.details);
  },
  'whatsapp:sync_complete': () => {
    syncStateManager.update({
      state: SYNC_STATES.APPROVED,
      progress: 100,
      details: SYNC_MESSAGES[SYNC_STATES.APPROVED]
    });
    onComplete?.();
  },
  'whatsapp:sync_error': (error) => {
    syncStateManager.setError(error);
  }
}); 