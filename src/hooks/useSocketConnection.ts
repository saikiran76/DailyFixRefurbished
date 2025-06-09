import { useEffect, useRef, useState, useCallback } from 'react';
import { initializeSocket, disconnectSocket, getSocket } from '@/utils/socket';
import { getSupabaseClient } from '@/utils/supabase';
import { toast } from 'react-toastify';
import logger from '@/utils/logger';

const CONNECTION_CONFIG = {
  MAX_RECONNECT_ATTEMPTS: 3,
  RECONNECT_DELAY: 2000,
  CONNECTION_TIMEOUT: 30000
};

// Circuit breaker configuration
const CIRCUIT_BREAKER_CONFIG = {
  FAILURE_THRESHOLD: 5,
  RESET_TIMEOUT: 5 * 60 * 1000, // 5 minutes
  HALF_OPEN_TIMEOUT: 30 * 1000, // 30 seconds
  STATES: {
    CLOSED: 'closed',
    OPEN: 'open',
    HALF_OPEN: 'half-open'
  }
};

export const useSocketConnection = (platform: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const socketRef = useRef(null);
  const cleanupInProgressRef = useRef(false);
  const tokenValidRef = useRef(true);
  const reconnectAttemptsRef = useRef(0);
  const messageQueueRef = useRef([]);
  const eventCleanupRef = useRef([]);
  
  // Circuit breaker state
  const circuitBreakerRef = useRef({
    state: CIRCUIT_BREAKER_CONFIG.STATES.CLOSED,
    failures: 0,
    lastFailure: 0,
    lastSuccess: Date.now(),
    resetTimer: null
  });

  // Check circuit breaker state before operations
  const checkCircuitBreaker = useCallback(() => {
    const cb = circuitBreakerRef.current;
    const now = Date.now();
    
    logger.debug(`Circuit breaker check: ${cb.state} with ${cb.failures} failures`);
    
    // If circuit is open, check if reset timeout has passed
    if (cb.state === CIRCUIT_BREAKER_CONFIG.STATES.OPEN) {
      if (now - cb.lastFailure > CIRCUIT_BREAKER_CONFIG.RESET_TIMEOUT) {
        // Move to half-open state to test connection
        logger.info('Circuit breaker moving to half-open state');
        cb.state = CIRCUIT_BREAKER_CONFIG.STATES.HALF_OPEN;
        // Set timer to go back to open if not successful within timeout
        if (cb.resetTimer) clearTimeout(cb.resetTimer);
        cb.resetTimer = setTimeout(() => {
          if (cb.state === CIRCUIT_BREAKER_CONFIG.STATES.HALF_OPEN) {
            logger.warn('Circuit breaker reopening due to no success in half-open state');
            cb.state = CIRCUIT_BREAKER_CONFIG.STATES.OPEN;
          }
        }, CIRCUIT_BREAKER_CONFIG.HALF_OPEN_TIMEOUT);
        
        return true; // Allow the test request through
      }
      logger.debug('Circuit breaker still open, blocking request');
      return false; // Circuit still open
    }
    
    // If circuit is half-open or closed, allow the request
    return true;
  }, []);

  // Record success/failure for circuit breaker
  const recordSuccess = useCallback(() => {
    const cb = circuitBreakerRef.current;
    cb.lastSuccess = Date.now();
    
    if (cb.state === CIRCUIT_BREAKER_CONFIG.STATES.HALF_OPEN) {
      logger.info('Circuit breaker closing after successful half-open request');
      cb.state = CIRCUIT_BREAKER_CONFIG.STATES.CLOSED;
      if (cb.resetTimer) {
        clearTimeout(cb.resetTimer);
        cb.resetTimer = null;
      }
    }
    
    // Reset failure count on success
    cb.failures = 0;
  }, []);

  const recordFailure = useCallback(() => {
    const cb = circuitBreakerRef.current;
    cb.failures++;
    cb.lastFailure = Date.now();
    
    logger.debug(`Circuit breaker failure recorded: ${cb.failures}/${CIRCUIT_BREAKER_CONFIG.FAILURE_THRESHOLD}`);
    
    if (cb.failures >= CIRCUIT_BREAKER_CONFIG.FAILURE_THRESHOLD) {
      if (cb.state !== CIRCUIT_BREAKER_CONFIG.STATES.OPEN) {
        logger.warn(`Circuit breaker opening after ${cb.failures} consecutive failures`);
        cb.state = CIRCUIT_BREAKER_CONFIG.STATES.OPEN;
        // Notify user that requests are being blocked
        toast.error('Connection issues detected. Some messages may be delayed.');
      }
    }
  }, []);

  // Enhanced token retrieval with multiple fallbacks
  const getAuthToken = useCallback(async () => {
    // Try dailyfix_auth first
    let token = null;
    try {
      const authDataStr = localStorage.getItem('dailyfix_auth');
      if (authDataStr) {
        const authData = JSON.parse(authDataStr);
        token = authData.session?.access_token;
        if (token) {
          logger.debug('Token retrieved from dailyfix_auth');
          return token;
        }
      }
    } catch (e) {
      logger.error('Error parsing dailyfix_auth:', e);
    }
    
    // Try direct access_token next
    token = localStorage.getItem('access_token');
    if (token) {
      logger.debug('Token retrieved from access_token');
      return token;
    }
    
    // Try persist:auth as last resort
    try {
      const authStr = localStorage.getItem('persist:auth');
      if (authStr) {
        const authData = JSON.parse(authStr);
        const sessionData = JSON.parse(authData.session);
        token = sessionData?.access_token;
        if (token) {
          logger.debug('Token retrieved from persist:auth');
          return token;
        }
      }
    } catch (e) {
      logger.error('Error parsing persist:auth:', e);
    }
    
    logger.warn('No auth token found in any storage location');
    return null;
  }, []);

  // Validate token
  const validateToken = useCallback(async () => {
    try {
      // First try to get token from multiple sources
      const token = await getAuthToken();
      if (!token) return false;

      // Get Supabase client - CRITICAL FIX: Use getSupabaseClient() instead of direct import
      const supabase = getSupabaseClient();
      if (!supabase) {
        logger.error('Token validation error: Supabase client is not available');
        return false;
      }

      // Validate token with Supabase
      const { data: { user }, error } = await supabase.auth.getUser(token);
      
      return !error && !!user;
    } catch (error) {
      logger.error('Token validation error:', error);
      return false;
    }
  }, [getAuthToken]);

  // Clean up socket and event listeners
  const cleanupSocket = useCallback(async () => {
    if (cleanupInProgressRef.current) return;
    
    try {
      cleanupInProgressRef.current = true;
      
      // Clean up event listeners
      eventCleanupRef.current.forEach(cleanup => cleanup());
      eventCleanupRef.current = [];
      
      // Disconnect socket
      await disconnectSocket();
      
      // Reset state
      socketRef.current = null;
      setIsConnected(false);
      setConnectionStatus('disconnected');
      reconnectAttemptsRef.current = 0;
      
    } catch (error) {
      logger.error('Socket cleanup error:', error);
    } finally {
      cleanupInProgressRef.current = false;
    }
  }, []);

  // Handle reconnection
  const handleReconnection = useCallback(async () => {
    if (reconnectAttemptsRef.current >= CONNECTION_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.warn('Max reconnection attempts reached');
      setConnectionStatus('error');
      toast.error('Connection lost. Please refresh the page.');
      await cleanupSocket();
      return;
    }

    try {
    //   Use the enhanced token retrieval
      const token = await getAuthToken();
      if (!token) {
        console.error('No auth token found');
        setConnectionStatus('error');
        await cleanupSocket();
        return;
      }

      reconnectAttemptsRef.current++;
      setConnectionStatus('reconnecting');
      
      // Exponential backoff
      const delay = Math.min(
        CONNECTION_CONFIG.RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current - 1),
        10000
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      await initializeSocket({
        platform,
        onConnect: () => {
          setIsConnected(true);
          setConnectionStatus('connected');
          reconnectAttemptsRef.current = 0;
        },
        onDisconnect: () => {
          setIsConnected(false);
          setConnectionStatus('disconnected');
        },
        onError: (error: any) => {
          console.error('Socket error:', error);
          setConnectionStatus('error');
        },
        onAuthError: async () => {
        //   const isStillValid = await validateToken();
        //   if (!isStillValid) {
        //     await cleanupSocket();
        //   }
        }
      });
    } catch (error) {
      console.error('Reconnection attempt failed:', error);
      handleReconnection();
    }
  }, [cleanupSocket, validateToken, platform, getAuthToken]);

  // Initialize socket connection
  const initializeSocketConnection = useCallback(async () => {
    if (socketRef.current || cleanupInProgressRef.current) {
      logger.debug('Socket already exists or cleanup in progress');
      return socketRef.current;
    }

    try {
      // Validate token before attempting connection
      const isValid = await validateToken();
      if (!isValid) {
        tokenValidRef.current = false;
        logger.debug('Token validation failed');
        await cleanupSocket();
        return null;
      }

      // Get fresh token using enhanced method
      const token = await getAuthToken();
      if (!token) {
        logger.error('No auth token found');
        setConnectionStatus('error');
        await cleanupSocket();
        return null;
      }

      tokenValidRef.current = true;
      setConnectionStatus('connecting');
      
      const socket = await initializeSocket({
        platform,
        onConnect: () => {
          setIsConnected(true);
          setConnectionStatus('connected');
          reconnectAttemptsRef.current = 0;
        },
        onDisconnect: () => {
          setIsConnected(false);
          setConnectionStatus('disconnected');
        },
        onError: (error) => {
          logger.error('Socket error:', error);
          setConnectionStatus('error');
        },
        onAuthError: async () => {
          const isStillValid = await validateToken();
          if (!isStillValid) {
            await cleanupSocket();
          }
        }
      });

      if (!socket) {
        throw new Error('Failed to create socket connection');
      }

      socketRef.current = socket;
      return socket;
    } catch (error) {
      logger.error('Socket initialization error:', error);
      setConnectionStatus('error');
      await cleanupSocket();
      return null;
    }
  }, [validateToken, cleanupSocket, platform, getAuthToken]);

  // Safe emit wrapper
  const emit = useCallback(async (event, data) => {
    // Check circuit breaker first
    if (!checkCircuitBreaker()) {
      logger.warn(`Circuit breaker open, queueing message: ${event}`);
      messageQueueRef.current.push({ 
        event, 
        data,
        timestamp: Date.now()
      });
      return false;
    }
    
    const socket = getSocket();
    if (!socket?.connected) {
      logger.debug('Socket not connected, queueing message:', event);
      messageQueueRef.current.push({ 
        event, 
        data,
        timestamp: Date.now()
      });
      return false;
    }

    try {
      const result = await socket.emit(event, data);
      // Record success for circuit breaker
      recordSuccess();
      return result;
    } catch (error) {
      logger.error('Emit error:', error);
      // Record failure for circuit breaker
      recordFailure();
      return false;
    }
  }, [checkCircuitBreaker, recordSuccess, recordFailure]);

  // Enhanced emit with acknowledgment handling
  const emitWithAck = useCallback((event, data, options = {}) => {
    return new Promise((resolve, reject) => {
      // Check circuit breaker first
      if (!checkCircuitBreaker()) {
        logger.warn(`Circuit breaker open, queueing message with ack: ${event}`);
        messageQueueRef.current.push({ 
          event, 
          data, 
          resolve, 
          reject,
          hasAck: true,
          timestamp: Date.now(),
          options
        });
        return;
      }
      
      const socket = getSocket();
      if (!socket?.connected) {
        logger.debug('Socket not connected, queueing message with ack:', event);
        // Store the promise callbacks with the message
        messageQueueRef.current.push({ 
          event, 
          data, 
          resolve, 
          reject,
          hasAck: true,
          timestamp: Date.now(),
          options
        });
        return;
      }
      
      // Set timeout for acknowledgment
      const timeout = options.timeout || 5000;
      let timeoutId = null;
      
      // Handle potential errors in a safe way
      try {
        timeoutId = setTimeout(() => {
          logger.warn(`Acknowledgment timeout for ${event} after ${timeout}ms`);
          recordFailure(); // Record failure for circuit breaker
          reject(new Error(`Acknowledgment timeout for ${event}`));
        }, timeout);
        
        // Emit with acknowledgment
        socket.emit(event, data, (response) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          if (response?.success === false) {
            logger.warn(`Emit ${event} failed:`, response.reason || 'Unknown reason');
            recordFailure(); // Record failure for circuit breaker
            reject(new Error(response.reason || 'Emit failed'));
          } else {
            logger.debug(`Received acknowledgment for ${event}`);
            recordSuccess(); // Record success for circuit breaker
            resolve(response);
          }
        });
      } catch (error) {
        // Clean up timeout if there's an error
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        logger.error(`Error in emitWithAck for ${event}:`, error);
        recordFailure(); // Record failure for circuit breaker
        reject(error);
      }
    });
  }, [checkCircuitBreaker, recordSuccess, recordFailure]);

  // Safe event listener wrapper
  const addEventListener = useCallback((event, handler) => {
    const socket = getSocket();
    if (!socket) return () => {};

    socket.on(event, handler);
    const cleanup = () => socket.off(event, handler);
    eventCleanupRef.current.push(cleanup);
    return cleanup;
  }, []);

  // Initialize socket on mount
  useEffect(() => {
    const init = async () => {
    //   const isValid = await validateToken();
      if (true) {
        await initializeSocketConnection();
      }
    };
    
    init();
    return cleanupSocket;
  }, [platform, initializeSocketConnection, cleanupSocket]);

  // Load message queue from localStorage on mount
  useEffect(() => {
    try {
      const storedQueue = localStorage.getItem(`socket_message_queue_${platform}`);
      if (storedQueue) {
        const parsedQueue = JSON.parse(storedQueue);
        if (Array.isArray(parsedQueue)) {
          // Only restore messages less than 24 hours old
          const nowMs = Date.now();
          const validMessages = parsedQueue.filter(
            msg => (nowMs - (msg.timestamp || 0)) < 24 * 60 * 60 * 1000
          );
          
          if (validMessages.length > 0) {
            logger.info(`Restored ${validMessages.length} queued messages for ${platform}`);
            messageQueueRef.current = validMessages;
          }
        }
      }
    } catch (e) {
      logger.error('Error restoring message queue:', e);
    }
  }, [platform]);

  // Process queued messages when connection is established
  useEffect(() => {
    if (isConnected && messageQueueRef.current.length > 0 && checkCircuitBreaker()) {
      logger.info(`Processing ${messageQueueRef.current.length} queued messages`);
      
      // Process in batches to avoid overwhelming the connection
      const processNextBatch = async () => {
        // Skip processing if circuit breaker is open
        if (!checkCircuitBreaker()) {
          logger.warn('Circuit breaker open, delaying message processing');
          return;
        }
        
        // Take up to 5 messages to process
        const batch = messageQueueRef.current.splice(0, 5);
        if (batch.length === 0) return;
        
        // Process each message
        for (const msg of batch) {
          try {
            const socket = getSocket();
            if (!socket?.connected) {
              // Put messages back in queue if disconnected during processing
              messageQueueRef.current.unshift(...batch);
              break;
            }
            
            if (msg.hasAck) {
              // Handle messages with acknowledgments
              socket.emit(msg.event, msg.data, (response) => {
                if (response?.success === false) {
                  recordFailure();
                  if (msg.reject) msg.reject(new Error(response.reason || 'Emit failed'));
                } else {
                  recordSuccess();
                  if (msg.resolve) msg.resolve(response);
                }
              });
            } else {
              // Handle regular messages
              socket.emit(msg.event, msg.data);
              // Assume success if no explicit failure
              recordSuccess();
            }
            
            // Small delay between messages
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (error) {
            logger.error(`Error processing queued message ${msg.event}:`, error);
            recordFailure();
            if (msg.reject) msg.reject(error);
          }
        }
        
        // If there are more messages, process next batch
        if (messageQueueRef.current.length > 0) {
          setTimeout(processNextBatch, 100);
        } else {
          // Save empty queue to localStorage
          try {
            localStorage.setItem(`socket_message_queue_${platform}`, JSON.stringify([]));
          } catch (e) {
            logger.error('Error saving empty message queue:', e);
          }
        }
      };
      
      processNextBatch();
    }
  }, [isConnected, platform, checkCircuitBreaker, recordSuccess, recordFailure]);

  // Circuit breaker status monitoring
  useEffect(() => {
    // Log circuit breaker status changes
    const interval = setInterval(() => {
      const cb = circuitBreakerRef.current;
      
      // If circuit breaker is in concerning state, log and notify
      if (cb.state !== CIRCUIT_BREAKER_CONFIG.STATES.CLOSED) {
        logger.info(`Circuit breaker status: ${cb.state}, failures: ${cb.failures}`);
        
        // If socket is disconnected and circuit breaker is open, attempt reconnection
        if (!isConnected && cb.state === CIRCUIT_BREAKER_CONFIG.STATES.OPEN) {
          logger.warn('Socket disconnected with open circuit breaker, attempting reconnection');
          handleReconnection();
        }
      }
    }, 30000); // Check every 30 seconds
    
    return () => clearInterval(interval);
  }, [isConnected, handleReconnection]);

  // Save message queue to localStorage when updated
  useEffect(() => {
    const saveQueue = () => {
      if (messageQueueRef.current.length > 0) {
        try {
          // Convert to serializable format (remove resolve/reject functions)
          const serializableQueue = messageQueueRef.current.map(({ resolve, reject, ...rest }) => rest);
          localStorage.setItem(
            `socket_message_queue_${platform}`, 
            JSON.stringify(serializableQueue)
          );
          logger.debug(`Saved ${serializableQueue.length} messages to queue for ${platform}`);
        } catch (e) {
          logger.error('Error saving message queue:', e);
        }
      }
    };
    
    // Set up interval to save queue periodically
    const intervalId = setInterval(saveQueue, 5000);
    
    // Save immediately when component unmounts
    return () => {
      clearInterval(intervalId);
      saveQueue();
    };
  }, [platform]);

  useEffect(() => {
    if (!socketRef.current) {
      logger.info('[useSocketConnection] No socket instance');
      return;
    }

    logger.info('[useSocketConnection] Setting up socket connection:', {
      namespace: platform,
      socketId: socketRef.current.id,
      connected: socketRef.current.connected
    });

    const handleConnect = () => {
      logger.info('[useSocketConnection] Socket connected:', {
        socketId: socketRef.current.id,
        namespace: platform
      });
    };

    const handleDisconnect = (reason) => {
      logger.info('[useSocketConnection] Socket disconnected:', {
        reason,
        socketId: socketRef.current.id,
        namespace: platform
      });
    };

    const handleError = (error) => {
      logger.error('[useSocketConnection] Socket error:', {
        error,
        socketId: socketRef.current.id,
        namespace: platform
      });
    };

    socketRef.current.on('connect', handleConnect);
    socketRef.current.on('disconnect', handleDisconnect);
    socketRef.current.on('error', handleError);

    return () => {
      socketRef.current.off('connect', handleConnect);
      socketRef.current.off('disconnect', handleDisconnect);
      socketRef.current.off('error', handleError);
    };
  }, [platform]);

  // Reset circuit breaker manually
  const resetCircuitBreaker = useCallback(() => {
    const cb = circuitBreakerRef.current;
    logger.info('Manually resetting circuit breaker');
    cb.state = CIRCUIT_BREAKER_CONFIG.STATES.CLOSED;
    cb.failures = 0;
    cb.lastFailure = 0;
    cb.lastSuccess = Date.now();
    if (cb.resetTimer) {
      clearTimeout(cb.resetTimer);
      cb.resetTimer = null;
    }
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    connectionStatus,
    emit,
    emitWithAck,
    on: addEventListener,
    messageQueue: messageQueueRef.current,
    // Circuit breaker information
    circuitBreaker: {
      state: circuitBreakerRef.current.state,
      failures: circuitBreakerRef.current.failures,
      reset: resetCircuitBreaker
    }
  };
};

// Export circuit breaker states for reference in components
export const CircuitBreakerStates = CIRCUIT_BREAKER_CONFIG.STATES;

export default useSocketConnection; 