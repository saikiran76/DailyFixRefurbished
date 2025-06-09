import { io } from 'socket.io-client';
import logger from './logger';
import tokenService from '../services/tokenService';

// Update socket URL configuration to use the API Gateway for all connections
const getSocketUrl = (platform: string) => {
  // Always use the API Gateway for socket connections
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  // CRITICAL FIX: Use different socket paths based on platform
  // The socket path must match exactly what the server expects
  let socketPath = '/socket.io'; // Default path for whatsapp service

  // For matrix, use the dedicated matrix socket endpoint
  if (platform === 'matrix') {
    socketPath = '/matrix/socket.io';
    logger.info('[Socket] Using matrix socket path');
  }
  
  // For telegram, use the dedicated telegram socket endpoint
  else if (platform === 'telegram') {
    socketPath = '/telegram/socket.io';
    logger.info('[Socket] Using telegram socket path');
  }

  // Log which platform we're connecting to (for debugging)
  logger.info(`[Socket] Using API Gateway (${apiUrl}) with path ${socketPath} for ${platform} socket connection`);

  return { url: apiUrl, path: socketPath };
};

logger.info('[Socket] Socket configuration:', {
  apiGateway: import.meta.env.VITE_API_URL || 'http://localhost:4000',
});

// Socket connection states for better state management
export const SOCKET_STATES = {
  INITIAL: 'initial',
  CONNECTING: 'connecting',
  AUTHENTICATING: 'authenticating',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error'
};

// CRITICAL FIX: Improve socket reconnection configuration
const CONNECTION_CONFIG = {
  RECONNECTION_ATTEMPTS: 10,     // Increased from 3 to 10
  RECONNECTION_DELAY: 1000,     // Decreased from 2000 to 1000
  RECONNECTION_DELAY_MAX: 5000, // Decreased from 10000 to 5000
  CONNECTION_TIMEOUT: 60000     // Increased from 30000 to 60000
};

let socketInstance = null;
let connectionPromise = null;
let messageHandler = null;
let connectionAttemptInProgress = false;

// Enhanced socket state tracking
let socketState = {
  state: SOCKET_STATES.INITIAL,
  authenticated: false,
  connecting: false,
  connectionStart: Date.now(),
  lastActivity: Date.now(),
  pendingOperations: new Set(),
  roomSubscriptions: new Set(),
  error: null,
  retryCount: 0,
  lastHeartbeat: Date.now()
};

// Discord message handling
export const subscribeToDiscordMessages = (channelId, handler) => {
  if (!socketInstance) {
    logger.info('Socket not initialized');
    return;
  }

  // Remove any existing handler
  if (messageHandler) {
    socketInstance.off('discord_message', messageHandler);
  }

  // Create a new handler that filters messages for this channel
  messageHandler = (data) => {
    if (data.message && data.message.channelId === channelId) {
      handler(data.message);
    }
  };

  // Subscribe to Discord messages
  socketInstance.on('discord_message', messageHandler);
};

export const unsubscribeFromDiscordMessages = () => {
  if (socketInstance && messageHandler) {
    socketInstance.off('discord_message', messageHandler);
    messageHandler = null;
  }
};

export const initializeSocket = async (options: { 
  platform: string;
  onConnect?: () => void;
  onDisconnect?: (reason?: string) => void;
  onError?: (error: any) => void;
  onAuthError?: () => void;
} = { platform: 'default' }) => {
  const platform = options.platform || 'default';
  const socketConfig = getSocketUrl(platform);
  const { url, path } = socketConfig;

  logger.info(`[Socket] Initializing ${platform} socket with URL: ${url} and path: ${path}`);

  if (connectionPromise) {
    logger.info('Returning existing connection promise');
    return connectionPromise;
  }

  if (socketInstance?.connected) {
    logger.info('Returning existing connected socket');
    return socketInstance;
  }

  try {
    connectionAttemptInProgress = true;
    socketState.state = SOCKET_STATES.CONNECTING;
    socketState.connectionStart = Date.now();

    connectionPromise = new Promise(async (resolve, reject) => {
      try {
        if (socketInstance && !socketInstance.connected) {
          logger.info('Cleaning up disconnected socket');
          await cleanupSocket();
        }

        // Get valid token using token service with improved error handling
        let tokens = null;
        let retryCount = 0;
        const maxRetries = CONNECTION_CONFIG.RECONNECTION_ATTEMPTS;
        let lastError = null;

        while (retryCount < maxRetries) {
          try {
            // Check if we have auth data in localStorage before trying tokenService
            let token = null;
            let userId = null;

            // First check 'dailyfix_auth'
            const authDataStr = localStorage.getItem('dailyfix_auth');
            if (authDataStr) {
              try {
                const authData = JSON.parse(authDataStr);
                if (authData?.session?.access_token) {
                  token = authData.session.access_token;
                  userId = authData.session.user?.id || authData.user?.id;
                  logger.info(`[Socket] Found token in dailyfix_auth (attempt ${retryCount + 1}/${maxRetries})`);
                }
              } catch (parseError) {
                logger.warn(`[Socket] Error parsing dailyfix_auth (attempt ${retryCount + 1}/${maxRetries}):`, parseError.message);
              }
            }

            // Then check 'access_token'
            if (!token) {
              token = localStorage.getItem('access_token');
              if (token) {
                logger.info(`[Socket] Found token in access_token (attempt ${retryCount + 1}/${maxRetries})`);
                // Try to get user ID from other sources
                try {
                  const persistAuthStr = localStorage.getItem('persist:auth');
                  if (persistAuthStr) {
                    const persistAuth = JSON.parse(persistAuthStr);
                    const userStr = persistAuth.user;
                    if (userStr && userStr !== 'null') {
                      const user = JSON.parse(userStr);
                      userId = user?.id;
                    }
                  }
                } catch (parseError) {
                  logger.warn('[Socket] Error parsing persist:auth:', parseError.message);
                }
              }
            }

            // Then check 'persist:auth'
            if (!token) {
              try {
                const persistAuthStr = localStorage.getItem('persist:auth');
                if (persistAuthStr) {
                  const persistAuth = JSON.parse(persistAuthStr);
                  const sessionStr = persistAuth.session;
                  if (sessionStr && sessionStr !== 'null') {
                    const session = JSON.parse(sessionStr);
                    token = session?.access_token;

                    const userStr = persistAuth.user;
                    if (userStr && userStr !== 'null') {
                      const user = JSON.parse(userStr);
                      userId = user?.id;
                    }

                    logger.info(`[Socket] Found token in persist:auth (attempt ${retryCount + 1}/${maxRetries})`);
                  }
                }
              } catch (parseError) {
                logger.warn(`[Socket] Error parsing persist:auth (attempt ${retryCount + 1}/${maxRetries}):`, parseError.message);
              }
            }

            // CRITICAL FIX: Allow connection with just a token, even if userId cannot be extracted
            if (token) {
              // Try to extract userId from token if not provided directly
              if (!userId) {
                try {
                  // Try to extract userId from JWT token
                  const tokenParts = token.split('.');
                  if (tokenParts.length === 3) {
                    const payload = JSON.parse(atob(tokenParts[1]));
                    if (payload.sub) {
                      userId = payload.sub;
                      logger.info('[Socket] Extracted userId from token payload');
                    }
                  }
                } catch (err) {
                  logger.warn('[Socket] Failed to extract userId from token:', err);
                }
                
                // If still no userId, use a default value
                if (!userId) {
                  userId = 'default_user';
                  logger.warn('[Socket] Using default userId because none was found');
                }
              }
              
              tokens = {
                accessToken: token,
                userId: userId
              };
              logger.info('[Socket] Using token from localStorage with userId:', userId);
              break;
            }

            // If all direct methods failed, try tokenService as a last resort
            if (!token) {
              logger.warn(`[Socket] No token found in localStorage, trying tokenService (attempt ${retryCount + 1}/${maxRetries})`);
              const tokenData = await tokenService.getValidToken();
              tokens = {
                accessToken: tokenData.access_token,
                userId: tokenData.userId
              };
            }

            logger.info('[Socket] Successfully obtained valid token');
            break;
          } catch (error) {
            lastError = error;
            retryCount++;

            logger.warn(`[Socket] Failed to get token (attempt ${retryCount}/${maxRetries}):`, error.message);

            if (retryCount === maxRetries) {
              logger.error('[Socket] Maximum token retrieval attempts reached');
              throw error;
            }

            // Exponential backoff for retries
            const delay = Math.min(
              CONNECTION_CONFIG.RECONNECTION_DELAY * Math.pow(1.5, retryCount - 1),
              CONNECTION_CONFIG.RECONNECTION_DELAY_MAX
            );

            logger.info(`[Socket] Waiting ${delay}ms before retry ${retryCount}`);
            await new Promise(r => setTimeout(r, delay));
          }
        }

        if (!tokens?.accessToken) {
          const errorMsg = 'No valid access token available after retries';
          logger.error('[Socket] Fatal initialization error:', errorMsg);
          socketState.error = lastError || new Error(errorMsg);
          socketState.state = SOCKET_STATES.ERROR;

          // Add socket recovery guidance
          logger.info('[Socket] Recommended recovery: reload page or sign out and back in');

          throw new Error(errorMsg);
        }

        // Get socket URL and path based on platform
        const urlConfig = getSocketUrl(platform);
        const { url, path } = urlConfig;
        logger.info(`[Socket] Connecting to ${url} with path ${path}`);

        // CRITICAL FIX: Initialize socket with improved configuration
        logger.info(`[Socket] Connecting to ${url} with path ${path} for platform ${platform}`);

        // CRITICAL FIX: Only connect to socket if we have a valid platform
        if (!platform) {
          logger.error('[Socket] No platform specified for socket connection');
          reject(new Error('No platform specified for socket connection'));
          return;
        }

        // CRITICAL FIX: Use different configuration for different platforms
        const socketConfig = {
          path: path, // Use the platform-specific socket path
          auth: {
            token: tokens.accessToken,
            userId: tokens.userId
          },
          reconnection: true,
          reconnectionAttempts: CONNECTION_CONFIG.RECONNECTION_ATTEMPTS,
          reconnectionDelay: CONNECTION_CONFIG.RECONNECTION_DELAY,
          reconnectionDelayMax: CONNECTION_CONFIG.RECONNECTION_DELAY_MAX,
          timeout: CONNECTION_CONFIG.CONNECTION_TIMEOUT,
          transports: ['polling', 'websocket'],  // Try polling first, then websocket
          forceNew: true,
          autoConnect: true,
          withCredentials: true,
          extraHeaders: {
            'Authorization': `Bearer ${tokens.accessToken}`
          },
          // Add ping configuration to detect disconnections faster
          pingTimeout: 10000,
          pingInterval: 5000
        };

        // Create the socket instance
        socketInstance = io(url, socketConfig);

        // CRITICAL FIX: Track this socket connection for global cleanup
        if (typeof window !== 'undefined') {
          window._socketConnections = window._socketConnections || [];
          window._socketConnections.push(socketInstance);
          logger.info(`[Socket] Socket instance created and tracked for ${platform}`);
        } else {
          logger.info(`[Socket] Socket instance created for ${platform}`);
        }

        // Instrument socket to track acknowledgment callbacks
        const originalOnevent = socketInstance.onevent;
        socketInstance.onevent = function(packet) {
          const args = packet.data || [];
          if (args.length > 0) {
            const [event] = args;
            const lastArg = args[args.length - 1];

            // If this is a whatsapp message and has an ack function
            if (typeof lastArg === 'function' && event && event.startsWith('whatsapp:')) {
              logger.debug(`[Socket] Received ${event} with acknowledgment`);

              // Wrap the acknowledgment function to improve logging
              const originalCallback = args[args.length - 1];
              args[args.length - 1] = function(...ackArgs) {
                logger.debug(`[Socket] Sending acknowledgment for ${event}:`, {
                  response: ackArgs[0],
                  timestamp: Date.now()
                });
                return originalCallback.apply(this, ackArgs);
              };
              packet.data = args;
            }
          }
          return originalOnevent.call(this, packet);
        };

        // Add handler for authentication response
        socketInstance.on('authenticated', (response) => {
          logger.info('[Socket] Authentication response:', response);
          socketState.authenticated = true;
          socketState.lastActivity = Date.now();

          // Initialize pending room subscriptions array if it doesn't exist
          if (!socketState.pendingRoomSubscriptions) {
            socketState.pendingRoomSubscriptions = [];
          }
        });

        // Add a connection timeout
        const connectionTimeout = setTimeout(() => {
          logger.error(`[Socket] Connection timeout for ${platform}`);
          reject(new Error('Socket connection timeout'));
        }, 10000);

        // Set up connection handlers
        socketInstance.on('connect', () => {
          // Clear the connection timeout
          clearTimeout(connectionTimeout);

          logger.info('[Socket] Socket connected successfully');
          socketState.state = SOCKET_STATES.CONNECTED;
          socketState.authenticated = true;
          socketState.error = null;
          socketState.retryCount = 0;
          socketState.lastActivity = Date.now();

          // Authenticate immediately after connection
          socketInstance.emit('authenticate', {
            token: tokens.accessToken,
            userId: tokens.userId
          });
          
          // Call the onConnect callback if provided
          if (options.onConnect && typeof options.onConnect === 'function') {
            options.onConnect();
          }
        });

        socketInstance.on('connect_error', (error) => {
          logger.error(`Socket connection error: ${error.message}`);
          socketState.state = SOCKET_STATES.ERROR;
          socketState.error = error;
          socketState.retryCount++;

          // CRITICAL FIX: Log more detailed error information
          logger.error(`Socket connection error details: ${JSON.stringify({
            attempt: socketState.retryCount,
            maxRetries,
            url,
            path,
            userId: tokens.userId,
            timestamp: new Date().toISOString()
          })}`);
          
          // Call the onError callback if provided
          if (options.onError && typeof options.onError === 'function') {
            options.onError(error);
          }

          if (socketState.retryCount >= maxRetries) {
            reject(new Error('Max reconnection attempts reached'));
          }
        });

        // CRITICAL FIX: Add more event handlers for better debugging
        socketInstance.on('reconnect_attempt', (attempt) => {
          logger.info(`Socket reconnection attempt ${attempt}`);
        });

        socketInstance.on('reconnect', (attempt) => {
          logger.info(`Socket reconnected after ${attempt} attempts`);
          // Re-authenticate after reconnection
          socketInstance.emit('authenticate', {
            token: tokens.accessToken,
            userId: tokens.userId
          });
          
          // Call the onConnect callback if provided
          if (options.onConnect && typeof options.onConnect === 'function') {
            options.onConnect();
          }
        });

        socketInstance.on('reconnect_error', (error) => {
          logger.error(`Socket reconnection error: ${error.message}`);
          
          // Call the onError callback if provided
          if (options.onError && typeof options.onError === 'function') {
            options.onError(error);
          }
        });

        socketInstance.on('reconnect_failed', () => {
          logger.error('Socket reconnection failed after all attempts');
          
          // Call the onError callback if provided
          if (options.onError && typeof options.onError === 'function') {
            options.onError(new Error('Socket reconnection failed after all attempts'));
          }
        });

        socketInstance.on('disconnect', (reason) => {
          logger.warn(`Socket disconnected: ${reason}`);
          socketState.state = SOCKET_STATES.DISCONNECTED;
          socketState.authenticated = false;
          
          // Call the onDisconnect callback if provided
          if (options.onDisconnect && typeof options.onDisconnect === 'function') {
            options.onDisconnect(reason);
          }

          if (reason === 'io server disconnect') {
            // Server initiated disconnect, attempt reconnection
            socketInstance.connect();
          }
        });

        socketInstance.on('error', (error) => {
          logger.error(`Socket error: ${error.message}`);
          
          // Call the onError callback if provided
          if (options.onError && typeof options.onError === 'function') {
            options.onError(error);
          }
        });
        
        // Listen for auth errors
        socketInstance.on('auth_error', (error) => {
          logger.error(`Socket auth error: ${error?.message || 'Unknown auth error'}`);
          
          // Call the onAuthError callback if provided
          if (options.onAuthError && typeof options.onAuthError === 'function') {
            options.onAuthError();
          }
        });

        // Set up heartbeat
        const heartbeatInterval = setInterval(() => {
          if (socketInstance?.connected) {
            socketInstance.emit('heartbeat');
            socketState.lastHeartbeat = Date.now();
          }
        }, 30000);

        // Clean up on window unload
        window.addEventListener('beforeunload', () => {
          clearInterval(heartbeatInterval);
          cleanupSocket();
        });

        // Wait for initial connection
        await new Promise((resolveConnection, rejectConnection) => {
          const timeout = setTimeout(() => {
            rejectConnection(new Error('Connection timeout'));
          }, CONNECTION_CONFIG.CONNECTION_TIMEOUT);

          socketInstance.once('connect', () => {
            clearTimeout(timeout);
            resolveConnection();
          });
        });

        resolve(socketInstance);
      } catch (error) {
        logger.error('Socket initialization error:', error);
        socketState.state = SOCKET_STATES.ERROR;
        socketState.error = error;
        reject(error);
      }
    });

    return await connectionPromise;
  } catch (error) {
    logger.error('Fatal socket initialization error:', error);
    throw error;
  } finally {
    connectionAttemptInProgress = false;
    connectionPromise = null;
  }
};

const cleanupSocket = async () => {
  if (socketInstance) {
    logger.info('[Socket] Cleaning up socket');

    // CRITICAL FIX: Remove this socket from the tracking array
    if (typeof window !== 'undefined' && window._socketConnections) {
      const index = window._socketConnections.indexOf(socketInstance);
      if (index !== -1) {
        window._socketConnections.splice(index, 1);
        logger.info('[Socket] Removed socket from tracking array');
      }
    }

    // Clean up token subscription if it exists
    if (socketInstance._tokenUnsubscribe) {
      socketInstance._tokenUnsubscribe();
      delete socketInstance._tokenUnsubscribe;
    }

    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
    connectionPromise = null;
  }
};

export const disconnectSocket = cleanupSocket;

export const getSocket = () => socketInstance;

export const checkSocketHealth = () => {
  if (!socketInstance) {
    return { connected: false, status: 'not_initialized', socket: null };
  }

  const health = {
    connected: socketInstance.connected,
    status: socketInstance.connected ? 'connected' : 'disconnected',
    socket: socketInstance,
    lastActivity: socketState.lastActivity,
    authenticated: socketState.authenticated,
    pendingOperations: socketState.pendingOperations.size,
    reconnectAttempts: 0
  };

  return health;
};

export function useSocket() {
  const [socket, setSocket] = useState(socketInstance);

  useEffect(() => {
    if (!socketInstance) {
      initializeSocket()
        .then(instance => setSocket(instance))
        .catch(error => logger.info('Socket initialization failed:', error));
    } else {
      setSocket(socketInstance);
    }
  }, []);

  return socket;
}

const handleTokenRefresh = async (socket, retryCount = 0) => {
  try {
    const tokens = await tokenService.getValidToken();
    if (!tokens?.access_token) {
      throw new Error('Failed to refresh tokens');
    }
    return tokens;
  } catch (error) {
    logger.error('Token refresh failed:', error);
    throw error;
  }
};

const handleReconnect = async (socket, options = {}) => {
  if (socketState.connecting) return;
  socketState.connecting = true;

  try {
    // Enhanced token refresh with retries
    const tokens = await handleTokenRefresh(socket);

    if (socket) {
    socket.auth.token = tokens.access_token;
    socket.auth.userId = tokens.userId;

    // Update socket state before reconnect
    socketState.lastTokenRefresh = Date.now();
    socketState.authenticated = false;

    socket.connect();

    logger.info('Reconnection initiated with fresh tokens', {
      userId: tokens.userId,
      tokenRefreshTime: socketState.lastTokenRefresh
    });
    }
  } catch (error) {
    logger.error('Reconnection failed after token refresh attempts:', error);
    if (options.onAuthError) {
      options.onAuthError(error);
    }
  } finally {
    socketState.connecting = false;
  }
};

const setupSocketListeners = (socket, options, resolve, reject) => {
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const INITIAL_RETRY_DELAY = 1000;
  let heartbeatTimeout = null;
  let lastHeartbeat = Date.now();
  let connectionTimeout = null;

  // Reset socket state for new connection
  socketState = {
    authenticated: false,
    connecting: false,
    connectionStart: Date.now(),
    lastActivity: Date.now(),
    pendingOperations: new Set(),
    roomSubscriptions: new Set()
  };

  const clearTimeouts = () => {
    if (heartbeatTimeout) {
      clearTimeout(heartbeatTimeout);
      heartbeatTimeout = null;
    }
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      connectionTimeout = null;
    }
  };

  const updateSocketMetrics = () => {
    if (!socket) return;

    const metrics = {
      connected: socket.connected,
      authenticated: socketState.authenticated,
      connectionDuration: Date.now() - socketState.connectionStart,
      lastHeartbeat,
      pendingOperations: socketState.pendingOperations.size,
      roomSubscriptions: Array.from(socketState.roomSubscriptions),
      reconnectAttempts
    };

    logger.info('[Socket Metrics]', metrics);
    return metrics;
  };

  // Enhanced connection timeout with retry
  const setupConnectionTimeout = () => {
    clearTimeout(connectionTimeout);
    connectionTimeout = setTimeout(async () => {
      if (!socket.connected) {
        logger.error('Socket connection timeout');

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          logger.info('Attempting reconnection after timeout');
          await handleReconnect(socket, options);
        } else {
          const error = new Error('Socket connection timeout after retries');
          if (options.onError) {
            options.onError(error);
          }
          reject(error);
        }
      }
    }, options.timeout || CONNECTION_CONFIG.CONNECTION_TIMEOUT);
  };

  socket.on('connect_error', async (error) => {
    logger.error('Socket connection error:', error);

    if (error.message.includes('auth')) {
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        await handleReconnect(socket, options);
      } else {
        if (options.onAuthError) {
          options.onAuthError(error);
        }
        reject(error);
      }
    } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const baseDelay = INITIAL_RETRY_DELAY * Math.pow(2, reconnectAttempts - 1);
      const jitter = Math.floor(Math.random() * 1000);
      const delay = Math.min(baseDelay + jitter, 30000);

      logger.info(`Attempting reconnection ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

      setTimeout(() => {
        if (!socket.connected) {
          handleReconnect(socket, options);
        }
      }, delay);
    } else if (options.onError) {
      options.onError(error);
      reject(error);
    }
  });

  const handleRoomSubscription = async (socket, roomId, action) => {
    try {
      if (action === 'join') {
        await socket.emit('room:join', roomId);
        socketState.roomSubscriptions.add(roomId);
        logger.info(`Room subscription requested: ${roomId}`);
      } else if (action === 'leave') {
        await socket.emit('room:leave', roomId);
        socketState.roomSubscriptions.delete(roomId);
        logger.info(`Room unsubscription requested: ${roomId}`);
      }
    } catch (error) {
      logger.info(`Room ${action} failed:`, {
        roomId,
        error: error.message,
        socketId: socket.id
      });
      throw error;
    }
  };

  const cleanupRoomSubscriptions = async (socket) => {
    const rooms = Array.from(socketState.roomSubscriptions);
    logger.info(`Cleaning up ${rooms.length} room subscriptions`);

    await Promise.allSettled(
      rooms.map(roomId => handleRoomSubscription(socket, roomId, 'leave'))
    ).then(results => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.info(`Failed to cleanup room subscription:`, {
            roomId: rooms[index],
            error: result.reason
          });
        }
      });
    });

    socketState.roomSubscriptions.clear();
  };

  socket.on('disconnect', async (reason) => {
    logger.info('Socket disconnected:', reason);
    clearTimeouts();

    // Update state
    socketState.authenticated = false;
    socketState.lastActivity = Date.now();

    // Clean up room subscriptions
    await cleanupRoomSubscriptions(socket);

    // Handle disconnects that should trigger a reconnect
    if (reason === 'io server disconnect' || reason === 'transport close') {
      reconnectAttempts = 0; // Reset counter for new connection attempt
      handleReconnect(socket, options);
    }

    if (options.onDisconnect) {
      options.onDisconnect(reason);
    }

    // Log final metrics
    updateSocketMetrics();
  });

  socket.on('auth:error', (error) => {
    logger.info('Socket authentication error:', error);
    socketState.authenticated = false;

    if (error.retryable) {
      logger.info(`Waiting for auth retry ${error.retryCount}, next attempt in ${error.nextRetryDelay}ms`);
      // Server will handle retry
    } else if (options.onAuthError) {
      options.onAuthError(error);
    }
  });

  socket.on('auth:success', (data) => {
    logger.info('Socket authenticated:', data);
    socketState.authenticated = true;
    socketState.lastActivity = Date.now();
    socketState.connecting = false;
    reconnectAttempts = 0; // Reset counter on successful auth

    // Update metrics
    updateSocketMetrics();
  });

  socket.on('heartbeat', (data) => {
    lastHeartbeat = data.timestamp;
    socketState.lastActivity = Date.now();
    socket.emit('heartbeat_ack');

    // Clear existing timeout
    clearTimeout(heartbeatTimeout);

    // Set new timeout for missing heartbeat
    heartbeatTimeout = setTimeout(() => {
      logger.warn('Missed heartbeat, checking connection...', {
        lastHeartbeat,
        timeSinceLastHeartbeat: Date.now() - lastHeartbeat
      });

      if (!socket.connected) {
        handleReconnect(socket, options);
      }
    }, 45000); // 45 second timeout
  });

  socket.on('connection:duplicate', (data) => {
    logger.warn('Duplicate connection detected:', data);
    if (options.onDuplicateConnection) {
      options.onDuplicateConnection(data);
    }
  });

  // Room subscription handling
  socket.on('room:joined', ({ roomId }) => {
    socketState.roomSubscriptions.add(roomId);
    logger.info(`Joined room: ${roomId}`, {
      currentRooms: Array.from(socketState.roomSubscriptions)
    });
  });

  socket.on('room:left', ({ roomId }) => {
    socketState.roomSubscriptions.delete(roomId);
    logger.info(`Left room: ${roomId}`, {
      currentRooms: Array.from(socketState.roomSubscriptions)
    });
  });

  socket.on('room:error', ({ roomId, error }) => {
    logger.info(`Room error for ${roomId}:`, {
      error,
      socketId: socket.id,
      currentRooms: Array.from(socketState.roomSubscriptions)
    });
  });

  socket.on('connect', () => {
    clearTimeouts();
    socketState.state = SOCKET_STATES.AUTHENTICATING;
    socketState.connectionStart = Date.now();
    socketState.lastActivity = Date.now();
    if (options.onStateChange) {
      options.onStateChange(socketState);
    }
    resolve(socket);
  });

  // Set initial connection timeout
  setupConnectionTimeout();
};

// Enhanced socket manager with proper state synchronization
class SocketManager {
  constructor() {
    // Direct reference to socketState instead of copying
    this.state = socketState;
    this.socket = null;
    this.connectionPromise = null;
    this.eventHandlers = new Map();
    this.stateChangeListeners = new Set();
    this.connectionTimeout = null;
    this.heartbeatTimeout = null;
  }

  // State management
  updateState(updates) {
    Object.assign(this.state, updates);
    // Notify listeners of state change
    this.stateChangeListeners.forEach(listener => listener(this.state));
  }

  onStateChange(listener) {
    this.stateChangeListeners.add(listener);
    return () => this.stateChangeListeners.delete(listener);
  }

  // Enhanced socket readiness check
  isReady() {
    return this.socket?.connected && this.state.authenticated &&
           this.state.state === SOCKET_STATES.CONNECTED;
  }

  // Enhanced emit with connection waiting
  async emit(event, data, options = {}) {
      if (!this.isReady()) {
      if (options.waitForConnection) {
        await this.waitForConnection(options.timeout);
      } else {
        throw new Error('Socket not ready for operations');
      }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Event emission timeout'));
      }, options.timeout || 5000);

      this.socket.emit(event, data, (response) => {
        clearTimeout(timeout);
        if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }

  // Enhanced event subscription
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event).add(handler);

    if (this.socket) {
      this.socket.on(event, handler);
    }

    return () => this.off(event, handler);
  }

  // Enhanced event unsubscription
  off(event, handler) {
    if (this.socket) {
      this.socket.off(event, handler);
    }

    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  // Reattach event handlers after reconnection
  reattachEventHandlers(socket) {
    for (const [event, handlers] of this.eventHandlers) {
      for (const handler of handlers) {
        socket.on(event, handler);
      }
    }
  }

  // Enhanced connection with proper state transitions
  async connect(options = {}) {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.updateState({
      state: SOCKET_STATES.CONNECTING,
      error: null,
      retryCount: 0,
      connecting: true
    });

    try {
      const socket = await initializeSocket({
        ...options,
        onStateChange: (newState) => this.updateState(newState)
      });

      this.socket = socket;
      this.reattachEventHandlers(socket);

      return socket;
    } catch (error) {
      this.updateState({
        state: SOCKET_STATES.ERROR,
        error,
        connecting: false
      });
      throw error;
    }
  }

  // Wait for connection to be ready
  waitForConnection(timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (this.isReady()) {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Connection timeout'));
      }, timeout);

      const onStateChange = (state) => {
        if (this.isReady()) {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.stateChangeListeners.delete(onStateChange);
      };

      this.stateChangeListeners.add(onStateChange);
    });
  }

  // Enhanced health check
  checkHealth() {
    return {
      state: this.state.state,
      connected: this.socket?.connected || false,
      authenticated: this.state.authenticated,
      lastActivity: this.state.lastActivity,
      lastHeartbeat: this.state.lastHeartbeat,
      pendingOperations: this.state.pendingOperations.size,
      roomSubscriptions: Array.from(this.state.roomSubscriptions),
      error: this.state.error,
      retryCount: this.state.retryCount,
      uptime: this.state.connectionStart ? Date.now() - this.state.connectionStart : 0
    };
  }

  // Enhanced disconnect
  async disconnect() {
    this.updateState({
      state: SOCKET_STATES.DISCONNECTED,
      authenticated: false,
      connecting: false
    });

    await cleanupSocket();
    this.socket = null;
    this.connectionPromise = null;
  }
}

// Create singleton instance
const socketManager = new SocketManager();

export default socketManager;
