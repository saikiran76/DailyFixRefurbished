import socketManager from '../utils/socket';
import logger from '../utils/logger';

const HEALTH_CHECK_INTERVAL = 10000; // 10 seconds
const MAX_MISSED_HEARTBEATS = 3;

class SocketHealthMonitor {
  constructor() {
    this.missedHeartbeats = 0;
    this.lastHeartbeat = Date.now();
    this.isMonitoring = false;
    this.healthCheckInterval = null;
    this.listeners = new Set();
  }

  startMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.performHealthCheck();
    
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, HEALTH_CHECK_INTERVAL);
  }

  stopMonitoring() {
    this.isMonitoring = false;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async performHealthCheck() {
    try {
      const socket = socketManager.socket;
      if (!socket) {
        this.notifyUnhealthy('Socket not initialized');
        return;
      }

      if (!socket.connected) {
        this.notifyUnhealthy('Socket disconnected');
        return;
      }

      // Send heartbeat
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Heartbeat timeout'));
        }, 5000);

        socket.emit('heartbeat', null, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });
      });

      if (response?.status === 'ok') {
        this.missedHeartbeats = 0;
        this.lastHeartbeat = Date.now();
        this.notifyHealthy();
      } else {
        this.handleMissedHeartbeat();
      }
    } catch (error) {
      logger.info('[SocketHealth] Health check failed:', error);
      this.handleMissedHeartbeat();
    }
  }

  handleMissedHeartbeat() {
    this.missedHeartbeats++;
    if (this.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
      this.notifyUnhealthy('Too many missed heartbeats');
      socketManager.socket?.disconnect();
      socketManager.socket?.connect();
    }
  }

  notifyHealthy() {
    this.listeners.forEach(listener => {
      listener({
        healthy: true,
        lastHeartbeat: this.lastHeartbeat,
        missedHeartbeats: 0
      });
    });
  }

  notifyUnhealthy(reason) {
    this.listeners.forEach(listener => {
      listener({
        healthy: false,
        lastHeartbeat: this.lastHeartbeat,
        missedHeartbeats: this.missedHeartbeats,
        reason
      });
    });
  }

  onHealthChange(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus() {
    return {
      healthy: this.missedHeartbeats < MAX_MISSED_HEARTBEATS,
      lastHeartbeat: this.lastHeartbeat,
      missedHeartbeats: this.missedHeartbeats,
      isMonitoring: this.isMonitoring
    };
  }
}

export const socketHealthMonitor = new SocketHealthMonitor(); 