import logger from './logger';

class AtomicLock {
  constructor() {
    this.locks = new Map();
    this.queues = new Map();
  }

  async acquire(key) {
    if (!this.queues.has(key)) {
      this.queues.set(key, []);
    }

    const queue = this.queues.get(key);
    const promise = new Promise(resolve => {
      queue.push(resolve);
    });

    if (!this.locks.get(key)) {
      this.locks.set(key, true);
      queue.shift()?.(true);
    }

    const acquired = await promise;
    return acquired;
  }

  release(key) {
    const queue = this.queues.get(key);
    if (queue?.length) {
      queue.shift()?.(true);
    } else {
      this.locks.delete(key);
      this.queues.delete(key);
    }
  }
}

const lockManager = new AtomicLock();

export async function executeAtomically(key, operation) {
  try {
    await lockManager.acquire(key);
    const result = await operation();
    return result;
  } catch (error) {
    logger.info('[AtomicOperation] Error:', error);
    throw error;
  } finally {
    lockManager.release(key);
  }
} 