import { executeAtomically } from '../utils/atomicOperations';
import logger from '../utils/logger';

const QUEUE_PRIORITIES = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2
};

const SYNC_PRIORITIES = {
  'full': QUEUE_PRIORITIES.HIGH,
  'messages': QUEUE_PRIORITIES.MEDIUM,
  'contacts': QUEUE_PRIORITIES.LOW
};

class SyncQueueManager {
  constructor() {
    this.queues = new Map(); // userId -> Array<QueueItem>
    this.activeSync = new Map(); // userId -> { type, promise }
    this.maxConcurrentSyncs = 3;
    this.activeSyncCount = 0;
  }

  async queueSync(userId, type, syncFn, options = {}) {
    try {
      return await executeAtomically(`queue-${userId}`, async () => {
        const queue = this.getOrCreateQueue(userId);
        const priority = options.priority ?? SYNC_PRIORITIES[type] ?? QUEUE_PRIORITIES.LOW;

        // Create queue item
        const queueItem = {
          id: `${userId}-${type}-${Date.now()}`,
          type,
          priority,
          syncFn,
          options,
          promise: null,
          resolve: null,
          reject: null
        };

        // Create promise that will be resolved when sync completes
        queueItem.promise = new Promise((resolve, reject) => {
          queueItem.resolve = resolve;
          queueItem.reject = reject;
        });

        // Add to queue and sort by priority
        queue.push(queueItem);
        this.sortQueue(queue);

        // Process queue if possible
        await this.processQueue(userId);

        return queueItem.promise;
      });
    } catch (error) {
      logger.info('[SyncQueue] Error queuing sync:', error);
      throw error;
    }
  }

  getOrCreateQueue(userId) {
    if (!this.queues.has(userId)) {
      this.queues.set(userId, []);
    }
    return this.queues.get(userId);
  }

  sortQueue(queue) {
    queue.sort((a, b) => {
      // Sort by priority first
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Then by timestamp (older first)
      return a.id.localeCompare(b.id);
    });
  }

  async processQueue(userId) {
    const queue = this.queues.get(userId);
    if (!queue?.length) return;

    // Check if this user already has an active sync
    if (this.activeSync.has(userId)) {
      return;
    }

    // Check if we've reached max concurrent syncs
    if (this.activeSyncCount >= this.maxConcurrentSyncs) {
      return;
    }

    // Get next item from queue
    const item = queue.shift();
    if (!item) return;

    try {
      this.activeSyncCount++;
      this.activeSync.set(userId, {
        type: item.type,
        promise: item.promise
      });

      // Execute sync function
      const result = await item.syncFn();
      item.resolve(result);
    } catch (error) {
      logger.info('[SyncQueue] Sync error:', error);
      item.reject(error);

      // If sync failed due to token/auth error, clear entire queue
      if (error.message?.includes('token') || error.message?.includes('auth')) {
        this.clearQueue(userId);
      }
    } finally {
      this.activeSync.delete(userId);
      this.activeSyncCount--;

      // Process next item in queue
      await this.processQueue(userId);
    }
  }

  clearQueue(userId) {
    const queue = this.queues.get(userId);
    if (!queue) return;

    // Reject all pending items
    queue.forEach(item => {
      item.reject(new Error('Queue cleared'));
    });

    this.queues.delete(userId);
  }

  getQueueStatus(userId) {
    const queue = this.queues.get(userId);
    const activeSync = this.activeSync.get(userId);

    return {
      queueLength: queue?.length ?? 0,
      activeSync: activeSync ? {
        type: activeSync.type
      } : null,
      totalActive: this.activeSyncCount
    };
  }

  pauseQueue(userId) {
    const queue = this.queues.get(userId);
    if (!queue) return;

    queue.forEach(item => {
      item.options.paused = true;
    });
  }

  resumeQueue(userId) {
    const queue = this.queues.get(userId);
    if (!queue) return;

    queue.forEach(item => {
      item.options.paused = false;
    });

    // Try to process queue
    this.processQueue(userId);
  }
}

export const syncQueueManager = new SyncQueueManager(); 