import io from 'socket.io-client';
import logger from './logger';

// Socket instance
let socket = null;

// Socket connection options
const defaultOptions = {
  timeout: 30000,
  forceNew: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 2000,
  transports: ['websocket', 'polling'],
  upgrade: true,
  rememberUpgrade: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  extraHeaders: {
    'Connection': 'keep-alive',
    'Keep-Alive': 'timeout=300'
  }
};

/**
 * Initialize socket connection
 * @param {Object} options - Socket connection options
 * @returns {Object} Socket instance
 */
export const initializeSocket = async (options = {}) => {
  try {
    // If socket already exists and is connected, return it
    if (socket && socket.connected) {
      logger.info('[SocketManager] Socket already connected');
      return socket;
    }

    // If socket exists but is disconnected, reconnect it
    if (socket) {
      logger.info('[SocketManager] Reconnecting existing socket');
      socket.connect();
      return socket;
    }

    // Create new socket
    logger.info('[SocketManager] Creating new socket connection');
    
    // Get API URL from environment
    const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:3001';
    
    // Create socket with merged options
    socket = io(apiUrl, {
      ...defaultOptions,
      ...options
    });

    // Set up event listeners
    socket.on('connect', () => {
      logger.info('[SocketManager] Socket connected');
    });

    socket.on('disconnect', (reason) => {
      logger.warn(`[SocketManager] Socket disconnected: ${reason}`);
    });

    socket.on('connect_error', (error) => {
      logger.error('[SocketManager] Socket connection error:', error);
    });

    socket.on('error', (error) => {
      logger.error('[SocketManager] Socket error:', error);
    });

    // Wait for connection
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Socket connection timeout'));
      }, options.timeout || defaultOptions.timeout);

      socket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    return socket;
  } catch (error) {
    logger.error('[SocketManager] Error initializing socket:', error);
    throw error;
  }
};

/**
 * Get socket instance
 * @returns {Object|null} Socket instance or null if not initialized
 */
export const getSocket = () => {
  return socket;
};

/**
 * Check socket health
 * @returns {Object} Socket health status
 */
export const checkSocketHealth = () => {
  if (!socket) {
    return {
      connected: false,
      socket: null
    };
  }

  return {
    connected: socket.connected,
    socket
  };
};

/**
 * Disconnect socket
 */
export const disconnectSocket = () => {
  if (socket) {
    logger.info('[SocketManager] Disconnecting socket');
    socket.disconnect();
  }
};

/**
 * Clean up socket
 */
export const cleanupSocket = () => {
  if (socket) {
    logger.info('[SocketManager] Cleaning up socket');
    socket.disconnect();
    socket.removeAllListeners();
    socket = null;
  }
};
