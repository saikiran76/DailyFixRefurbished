export class MessageBatchProcessor {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 50;
    this.batchTimeout = options.batchTimeout || 1000;
    this.messageBuffer = [];
    this.timeoutId = null;
    this.processing = false;
    this.onBatchProcess = options.onBatchProcess;
    this.onError = options.onError;
  }

  addMessage(message) {
    this.messageBuffer.push({
      ...message,
      timestamp: Date.now()
    });
    this.scheduleBatchProcessing();
  }

  scheduleBatchProcessing() {
    if (this.messageBuffer.length >= this.batchSize) {
      this.processBatch();
    } else if (!this.timeoutId) {
      this.timeoutId = setTimeout(() => this.processBatch(), this.batchTimeout);
    }
  }

  async processBatch() {
    if (this.processing || this.messageBuffer.length === 0) return;

    const batchMessages = this.messageBuffer.splice(0, this.batchSize);
    
    try {
      this.processing = true;
      await this.onBatchProcess(batchMessages);
    } catch (error) {
      console.error('Batch processing failed:', error);
      // Requeue failed messages at the start of the buffer
      this.messageBuffer.unshift(...batchMessages);
      if (this.onError) {
        this.onError(error, batchMessages);
      }
    } finally {
      this.processing = false;
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
      
      // If there are remaining messages, schedule next batch
      if (this.messageBuffer.length > 0) {
        this.scheduleBatchProcessing();
      }
    }
  }

  clear() {
    this.messageBuffer = [];
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.processing = false;
  }

  getStats() {
    return {
      bufferedMessages: this.messageBuffer.length,
      isProcessing: this.processing,
      hasTimeout: !!this.timeoutId
    };
  }
} 