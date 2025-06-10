import { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useSocketConnection } from '@/hooks/useSocketConnection';
import api from '@/utils/api';  // Our configured axios instance
import QRCode from 'qrcode';
import logger from '@/utils/logger';
import { toast } from 'react-hot-toast';
// EMERGENCY FIX: Removed supabase import to prevent infinite reload
// Use localStorage as a fallback for Whatsapp connection status
import { saveWhatsAppStatus } from '@/utils/connectionStorage';
import { shouldAllowCompleteTransition } from '@/utils/onboardingFix';
import PropTypes from 'prop-types';
import {
  setWhatsappQRCode,
  setWhatsappSetupState,
  setWhatsappError,
  resetWhatsappSetup,
  setBridgeRoomId,
  selectWhatsappSetup,
  setWhatsappConnected,
  setWhatsappTimeLeft
} from '@/store/slices/onboardingSlice';
import { getSupabaseClient } from '@/utils/supabase'; // CRITICAL FIX: Import getSupabaseClient for token refresh
import ErrorMessage from '@/components/ui/ErrorMessage';

// Import shadcn UI components
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, AlertTriangle, RefreshCw } from "lucide-react";
import LavaLamp from '@/components/ui/Loader/LavaLamp';

// Define interface for request config to include params
interface RequestConfig {
  timeout: number;
  params?: {
    login_type?: string;
    [key: string]: string | undefined;
  };
}

// Define Socket interface to fix TypeScript errors
interface Socket {
  emit: (event: string, ...args: any[]) => void;
  on: (event: string, callback: (data: any) => void) => void;
  off: (event: string) => void;
  connected: boolean;
}

// Update SocketConnection interface to type socket property
interface SocketConnection {
  socket: Socket | null;
  isConnected: boolean;
}

// CRITICAL FIX: Unique global initialization key with timestamp to prevent collisions
const Whatsapp_INIT_KEY = 'Whatsapp_initializing_' + Date.now();

// CRITICAL FIX: Add global state to track initialization across component instances
const GLOBAL_INIT_STATE = {
  isInitializing: false,
  lastInitAttempt: 0,
  mountCount: 0,
  mountTime: 0
};

interface WhatsappBridgeSetupProps {
  onComplete: () => void;
  onCancel: () => void;
  relogin?: boolean;
}

// CRITICAL FIX: Add reset function for initialization flags
export function resetWhatsappSetupFlags(forceReset = false) {
  // Only reset if force flag is passed
  if (forceReset) {
    // Reset global initialization state
    GLOBAL_INIT_STATE.isInitializing = false;
    GLOBAL_INIT_STATE.lastInitAttempt = 0;
    GLOBAL_INIT_STATE.mountCount = 0;
    GLOBAL_INIT_STATE.mountTime = 0;
    
    // Clear any session storage keys
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith('Whatsapp_initializing_')) {
        sessionStorage.removeItem(key);
      }
    });
    
    logger.info('[WhatsappBridgeSetup] All initialization flags reset');
  }
}

const WhatsappBridgeSetup = ({ onComplete, onCancel, relogin = false }: WhatsappBridgeSetupProps) => {
  const dispatch = useDispatch();
  const { socket, isConnected } = useSocketConnection('matrix') as SocketConnection;
  const { session } = useSelector((state: any) => state.auth);
  const {
    loading: reduxLoading,
    error: reduxError,
    qrCode,
    timeLeft,
    qrExpired,
    setupState
  } = useSelector(selectWhatsappSetup);

  // Component state
  const [isInitializing, setIsInitializing] = useState(true);
  const [showRetryButton, setShowRetryButton] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  // Use refs to track component state
  const qrReceivedRef = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // CRITICAL FIX: Add timer ref and interval
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const initializationRef = useRef(false);

  // CRITICAL FIX: Add stable mount tracking
  const mountTimeRef = useRef(Date.now());
  const stableComponentRef = useRef(false);

  // Stop polling function - defined first to avoid circular dependency
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      logger.info('[WhatsappBridgeSetup] Stopping polling for Whatsapp login status');
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      setIsPolling(false);
    }
  }, []);
  
  // CRITICAL FIX: Stop timer function
  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      logger.info('[WhatsappBridgeSetup] Stopping QR code timer');
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // Function to poll the Whatsapp login status
  const checkLoginStatus = useCallback(async () => {
    try {
      logger.info('[WhatsappBridgeSetup] Polling Whatsapp login status...');
      const response = await api.get('/api/v1/matrix/whatsapp/status', {
        timeout: 10000 // 10 second timeout to prevent hanging requests
      });

      logger.info('[WhatsappBridgeSetup] Status response:', response.data);

      // Check if Whatsapp is connected
      if (response.data?.status === 'active') {
        logger.info('[WhatsappBridgeSetup] Login status poll successful - Whatsapp connected!', response.data);

        // Stop polling and timer
        stopPolling();
        stopTimer();

        // Update the state
        dispatch(setWhatsappSetupState('connected'));
        dispatch(setWhatsappConnected(true));

        // Get bridge room ID from response if available
        if (response.data.bridgeRoomId) {
          dispatch(setBridgeRoomId(response.data.bridgeRoomId));
        }

        // Use localStorage as a fallback for Whatsapp connection status
        if (session?.user?.id) {
          saveWhatsAppStatus(true, session.user.id);
          logger.info('[WhatsappBridgeSetup] Saved Whatsapp connection status to localStorage');
          
          // Dispatch platform-connection-changed event to update UI components
          window.dispatchEvent(new CustomEvent('platform-connection-changed', {
            detail: {
              platform: 'whatsapp',
              isActive: true,
              timestamp: Date.now()
            }
          }));
          logger.info('[WhatsappBridgeSetup] Dispatched platform-connection-changed event');
          
          // Set WhatsApp as the active platform in localStorage
          localStorage.setItem('dailyfix_active_platform', 'whatsapp');
          logger.info('[WhatsappBridgeSetup] Set whatsapp as active platform in localStorage');
        }
        logger.info('[WhatsappBridgeSetup] Whatsapp connection detected');

        // Call onComplete callback if provided
        if (onComplete && typeof onComplete === 'function') {
          if (shouldAllowCompleteTransition()) {
            onComplete();
          }
        }
      }
    } catch (error) {
      logger.error('[WhatsappBridgeSetup] Error polling login status:', error);
    }
  }, [dispatch, onComplete, stopPolling, stopTimer, session]);

  // Start polling
  const startPolling = useCallback(() => {
    if (!isPolling && !pollIntervalRef.current) {
      logger.info('[WhatsappBridgeSetup] Starting polling for Whatsapp login status');
      setIsPolling(true);
      // Run once immediately
      checkLoginStatus();
      // Then set up interval
      const interval = setInterval(checkLoginStatus, 2000); // Poll every 2 seconds
      pollIntervalRef.current = interval;

      // Set a timeout to stop polling after 5 minutes (300 seconds) to prevent infinite polling
      setTimeout(() => {
        if (pollIntervalRef.current === interval) {
          logger.info('[WhatsappBridgeSetup] Stopping polling after timeout');
          clearInterval(interval);
          pollIntervalRef.current = null;
          setIsPolling(false);
        }
      }, 300000); // 5 minutes
    }
  }, [isPolling, checkLoginStatus]);
  
  // CRITICAL FIX: Start QR code timer function
  const startQrTimer = useCallback(() => {
    if (!timerIntervalRef.current) {
      logger.info('[WhatsappBridgeSetup] Starting QR code timer');
      
      // Create a ref to track current time
      const timeLeftRef = { current: 35 }; // Changed from 60 to 35 seconds
      
      // Start with 35 seconds for QR code validity
      dispatch(setWhatsappTimeLeft(timeLeftRef.current));
      
      const interval = setInterval(() => {
        timeLeftRef.current -= 1;
        dispatch(setWhatsappTimeLeft(timeLeftRef.current));
        
        if (timeLeftRef.current <= 0) {
          logger.info('[WhatsappBridgeSetup] QR code expired');
          clearInterval(interval);
          timerIntervalRef.current = null;
          
          // Set QR expired in Redux state
          dispatch(setWhatsappSetupState('error'));
          dispatch(setWhatsappError('QR code has expired. Please refresh to try again.'));
          
          // Show retry button and clear QR code from state
          setShowRetryButton(true);
        }
      }, 1000);
      
      timerIntervalRef.current = interval;
    }
  }, [dispatch]);

  // Track if component is mounted
  const isMountedRef = useRef(true);

  // Initialize connection to Whatsapp with retry logic
  const initializeConnection = useCallback(() => {
    // CRITICAL FIX: Check global initialization state to prevent duplicate calls across remounts
    if (GLOBAL_INIT_STATE.isInitializing) {
      logger.info('[WhatsappBridgeSetup] Global initialization already in progress, skipping duplicate call');
      return;
    }

    // CRITICAL FIX: Check if component is "stable" (mounted for at least 300ms)
    const componentAge = Date.now() - mountTimeRef.current;
    if (componentAge < 300) {
      logger.info(`[WhatsappBridgeSetup] Component too young (${componentAge}ms), delaying initialization`);
      setTimeout(() => {
        // Only proceed if still mounted
        if (isMountedRef.current) {
          logger.info('[WhatsappBridgeSetup] Component stabilized, now initializing');
          initializeConnection();
        } else {
          logger.info('[WhatsappBridgeSetup] Component unmounted during stabilization period');
          GLOBAL_INIT_STATE.isInitializing = false;
        }
      }, 500 - componentAge); // Wait until we've been mounted for at least 500ms
      return;
    }

    // CRITICAL FIX: Check if initialization is already in progress for this instance
    if (initializationRef.current) {
      logger.info('[WhatsappBridgeSetup] Initialization already in progress, skipping duplicate call');
      return;
    }
    
    // Set initialization flags
    initializationRef.current = true;
    GLOBAL_INIT_STATE.isInitializing = true;
    GLOBAL_INIT_STATE.lastInitAttempt = Date.now();
    
    logger.info('[WhatsappBridgeSetup] Initializing Whatsapp connection, attempt:', retryCount + 1);
    setIsInitializing(true);

    // Set a flag in sessionStorage to track initialization
    const initKey = Whatsapp_INIT_KEY;
    sessionStorage.setItem(initKey, 'true');

    // Calculate backoff delay (exponential: 1s, 2s, 4s, etc.)
    const backoffDelay = retryCount > 0 ? Math.pow(2, retryCount - 1) * 1000 : 0;

    // If this is a retry, wait before making the request
    setTimeout(() => {
      // CRITICAL FIX: Double-check we're still mounted
      if (!isMountedRef.current) {
        logger.info('[WhatsappBridgeSetup] Component unmounted during initialization delay, aborting');
        GLOBAL_INIT_STATE.isInitializing = false;
        sessionStorage.removeItem(initKey);
        return;
      }
      
      // CRITICAL FIX: Ensure we have a valid token before proceeding
      const verifyToken = async () => {
        try {
          // Enhanced debugging - Log the start of token verification
          logger.info('[WhatsappBridgeSetup] Starting token verification process');
          
          // Check if we have tokens available
          const accessToken = localStorage.getItem('access_token');
          const refreshToken = localStorage.getItem('refresh_token');
          
          // Log token availability (masked for security)
          logger.info('[WhatsappBridgeSetup] Token check:', { 
            hasAccessToken: !!accessToken, 
            hasRefreshToken: !!refreshToken,
            accessTokenLength: accessToken ? accessToken.length : 0
          });
          
          if (!accessToken && !refreshToken) {
            logger.error('[WhatsappBridgeSetup] No auth tokens found');
            throw new Error('Authentication required');
          }
          
          // Return the existing token if available
          if (accessToken) {
            logger.info('[WhatsappBridgeSetup] Using existing access token');
            return accessToken;
          } else if (refreshToken) {
            // Try to refresh the token
            logger.info('[WhatsappBridgeSetup] Attempting to refresh token');
            const supabase = getSupabaseClient();
            if (!supabase) {
              throw new Error('Supabase client not available');
            }
            
            const { data, error } = await supabase.auth.refreshSession({
              refresh_token: refreshToken
            });
            
            if (error) {
              logger.error('[WhatsappBridgeSetup] Token refresh failed:', error);
              throw error;
            }
            
            if (data?.session?.access_token) {
              // Store the new access token
              localStorage.setItem('access_token', data.session.access_token);
              logger.info('[WhatsappBridgeSetup] Token refreshed successfully');
              return data.session.access_token;
            }
          }
          
          throw new Error('Failed to get valid token');
        } catch (error) {
          logger.error('[WhatsappBridgeSetup] Token verification failed:', error);
          return null;
        }
      };
      
      // Validate token first, then make the request
      verifyToken().then(token => {
        if (!token) {
          // Handle auth error when no token is available
          logger.error('[WhatsappBridgeSetup] Authentication error, no valid token');
          setIsInitializing(false);
          dispatch(setWhatsappError('Authentication error. Please try signing in again.'));
          
          // Redirect to login after a delay
          setTimeout(() => {
            if (isMountedRef.current) {
              window.location.href = '/login';
            }
          }, 2000);
          
          // Clear initialization flags
          initializationRef.current = false;
          sessionStorage.removeItem(initKey);
          return;
        }
        
        // Set the token in API headers
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        logger.info('[WhatsappBridgeSetup] Authorization header set with token');

        // DEBUGGING: Log API instance state
        logger.info('[WhatsappBridgeSetup] API instance details:', {
          baseURL: api.defaults.baseURL,
          hasAuthHeader: !!api.defaults.headers.common['Authorization'],
          timeout: api.defaults.timeout
        });

        // Make API call to initialize Whatsapp connection
        logger.info(`[WhatsappBridgeSetup] Making API call to /api/v1/matrix/whatsapp/connect ${relogin ? 'with relogin flag' : ''}`);
        
        // Create request data/params based on relogin status
        const requestConfig: RequestConfig = {
          timeout: 60000 // 60 second timeout instead of 40 seconds to prevent hanging
        };
        
        // Add login_type parameter if this is a relogin
        if (relogin) {
          requestConfig.params = { login_type: 'relogin' };
        }
        
        // Add additional debug logs to help diagnose the issue
        const apiUrl = api.defaults.baseURL + '/api/v1/matrix/whatsapp/connect';
        console.log(`⚠️ DEBUG: Attempting API call to ${apiUrl} with timeout ${requestConfig.timeout}ms`);
        
        // DEBUGGING: Log the exact request being made
        logger.info('[WhatsappBridgeSetup] Preparing to send request with config:', {
          url: '/api/v1/matrix/whatsapp/connect',
          method: 'POST',
          timeout: requestConfig.timeout,
          params: requestConfig.params || 'none',
          headers: {
            Authorization: 'Bearer [MASKED]',
            'Content-Type': api.defaults.headers.common['Content-Type'] || 'application/json'
          }
        });
        
        try {
          // Wrap the API call in a try-catch to catch any synchronous errors
          api.post('/api/v1/matrix/whatsapp/connect', {}, requestConfig)
            .then(response => {
              logger.info('[WhatsappBridgeSetup] Whatsapp setup initialized successfully:', response.data);
              // Only update state if component is still mounted
              if (isMountedRef.current) {
                setIsInitializing(false);
                setRetryCount(0); // Reset retry count on success
              }

              // *** CRITICAL FIX: Process QR code directly from API response if available ***
              if (response.data && response.data.status === 'qr_ready' && response.data.qrCode) {
                logger.info('[WhatsappBridgeSetup] Processing QR code from API response...');
                QRCode.toDataURL(response.data.qrCode, {
                  errorCorrectionLevel: 'L',
                  margin: 4,
                  width: 256
                })
                .then(qrDataUrl => {
                  logger.info('[WhatsappBridgeSetup] QR code from API converted successfully');
                  if (!isMountedRef.current) return; // Skip if unmounted
                  
                  // Mark that QR was received before updating state
                  qrReceivedRef.current = true;
                  
                  // Update QR code in Redux
                  dispatch(setWhatsappQRCode(qrDataUrl));
                  
                  // Clear any previous errors and update setup state
                  dispatch(setWhatsappError(null));
                  dispatch(setWhatsappSetupState('qr_ready'));
                  
                  // Start polling for login status
                  startPolling();
                  
                  // CRITICAL FIX: Start QR code timer (1 minute countdown)
                  startQrTimer();
                })
                .catch(qrError => {
                  logger.error('[WhatsappBridgeSetup] Error converting QR code:', qrError);
                  dispatch(setWhatsappError('Error generating QR code'));
                  setShowRetryButton(true);
                });
              } else if (response.data && response.data.status === 'connected') {
                // Handle already connected state
                logger.info('[WhatsappBridgeSetup] Whatsapp already connected according to API response');
                dispatch(setWhatsappSetupState('connected'));
                dispatch(setWhatsappConnected(true));
                
                if (response.data.bridgeRoomId) {
                  dispatch(setBridgeRoomId(response.data.bridgeRoomId));
                }
                
                // Call onComplete callback if provided
                if (onComplete && typeof onComplete === 'function') {
                  if (shouldAllowCompleteTransition()) {
                    onComplete();
                  }
                }
              }
              
              // Clear initialization flags
              initializationRef.current = false;
              sessionStorage.removeItem(initKey);
            })
            .catch(error => {
              // Enhanced error logging
              logger.error('[WhatsappBridgeSetup] API call error details:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                isAxiosError: error.isAxiosError,
                config: {
                  url: error.config?.url,
                  method: error.config?.method,
                  baseURL: error.config?.baseURL,
                  timeout: error.config?.timeout
                }
              });
              
              // Only update state if component is still mounted
              if (isMountedRef.current) {
                setIsInitializing(false);
                
                // Check if this is an auth error
                if (error.response?.status === 401 || error.response?.status === 403) {
                  logger.error('[WhatsappBridgeSetup] Authentication error:', error);
                  dispatch(setWhatsappError('Authentication error. Please login again.'));
                  
                  // Redirect to login
                  setTimeout(() => {
                    window.location.href = '/login';
                  }, 2000);
                } else {
                  // For other errors, show retry button and increment retry count
                  logger.error('[WhatsappBridgeSetup] Error initializing Whatsapp connection:', error);
                  dispatch(setWhatsappError('Failed to initialize Whatsapp. Please try again.'));
                  setShowRetryButton(true);
                  
                  if (retryCount < maxRetries) {
                    setRetryCount(retryCount + 1);
                  }
                }
                
                // Clear initialization flags
                initializationRef.current = false;
                sessionStorage.removeItem(initKey);
              }
            });
        } catch (directError) {
          // Catch any errors that might occur when trying to make the API call itself
          logger.error('[WhatsappBridgeSetup] Critical error making API request:', directError);
          
          if (isMountedRef.current) {
            setIsInitializing(false);
            dispatch(setWhatsappError('Critical error initializing Whatsapp. Please try again.'));
            setShowRetryButton(true);
            
            // Clear initialization flags
            initializationRef.current = false;
            sessionStorage.removeItem(initKey);
          }
        }
        
        // Clear initialization flags in finally block to ensure cleanup
        }).finally(() => {
          // CRITICAL FIX: Ensure global state is cleaned up
          if (!isMountedRef.current) {
            GLOBAL_INIT_STATE.isInitializing = false;
          }
        });
    }, backoffDelay);
  }, [dispatch, relogin, retryCount, startPolling, maxRetries, startQrTimer, onComplete]);

  // Handle retry button click
  const handleRetry = useCallback(() => {
    logger.info('[WhatsappBridgeSetup] Retry button clicked, resetting all flags');
    setShowRetryButton(false);
    dispatch(resetWhatsappSetup());
    
    // Stop any existing timers
    stopTimer();
    stopPolling();

    // Force reset all initialization flags
    resetWhatsappSetupFlags(true);
    initializationRef.current = false;

    // Wait a short time to ensure all resets complete
    setTimeout(() => {
      // Reinitialize the connection
      initializeConnection();
    }, 500);
  }, [dispatch, initializeConnection, stopTimer, stopPolling]);

  // Start polling when QR code is displayed
  useEffect(() => {
    if (qrCode && !isPolling) {
      logger.info('[WhatsappBridgeSetup] QR code displayed, starting polling');
      qrReceivedRef.current = true;
      startPolling();
      
      // CRITICAL FIX: Also start the QR code timer
      startQrTimer();
    }
  }, [qrCode, startPolling, isPolling, startQrTimer]);

  // Handle socket connection
  useEffect(() => {
    if (socket && isConnected) {
      logger.info('[WhatsappBridgeSetup] Socket connected, joining room');

      // Join user room for targeted events
      if (session?.user?.id) {
        socket.emit('join', `user:${session.user.id}`);
        logger.info('[WhatsappBridgeSetup] Joining socket room:', `user:${session.user.id}`);
      }

      // CRITICAL FIX: Add listener for Whatsapp:qr event which contains the QR code token
      socket.on('Whatsapp:qr', (data: any) => {
        logger.info('[WhatsappBridgeSetup] Received Whatsapp:qr event with login token');
        
        if (data.qrCode && data.qrCode.startsWith('tg://login?token=')) {
          logger.info('[WhatsappBridgeSetup] Converting Whatsapp token to QR code image');
          // Convert QR code to data URL
          QRCode.toDataURL(data.qrCode, {
            errorCorrectionLevel: 'L',
            margin: 4,
            width: 256
          })
          .then(qrDataUrl => {
            logger.info('[WhatsappBridgeSetup] QR code converted successfully from token');
            if (!isMountedRef.current) return; // Skip if unmounted
            
            // Mark that QR was received before updating state
            qrReceivedRef.current = true;
            
            // Update QR code in Redux
            dispatch(setWhatsappQRCode(qrDataUrl));
            
            // Clear any previous errors and update setup state
            dispatch(setWhatsappError(null));
            dispatch(setWhatsappSetupState('qr_ready'));
            
            // Start polling for login status
            startPolling();
            
            // Start QR code timer (1 minute countdown)
            startQrTimer();
          })
          .catch(error => {
            logger.error('[WhatsappBridgeSetup] Error converting token to QR code:', error);
            dispatch(setWhatsappError('Failed to generate QR code from token'));
            dispatch(setWhatsappSetupState('error'));
          });
        } else {
          logger.warn('[WhatsappBridgeSetup] Received invalid Whatsapp:qr data:', data);
        }
      });

      // Listen for Whatsapp setup status updates
      socket.on('Whatsapp:setup:status', (data: any) => {
        logger.info('[WhatsappBridgeSetup] Received Whatsapp setup status update:', data);

        if (data.state === 'qr_ready' && data.qrCode) {
          // Convert QR code to data URL
          QRCode.toDataURL(data.qrCode, {
            errorCorrectionLevel: 'L',
            margin: 4,
            width: 256
          })
          .then(qrDataUrl => {
            logger.info('[WhatsappBridgeSetup] QR code converted successfully');
            // CRITICAL FIX: Mark that QR was received before updating state
            qrReceivedRef.current = true;
            dispatch(setWhatsappQRCode(qrDataUrl));
            dispatch(setWhatsappSetupState('qr_ready'));
            
            // CRITICAL FIX: Start QR code timer (1 minute countdown)
            startQrTimer();
            
            // Start polling for login status
            startPolling();
          })
          .catch(error => {
            logger.error('[WhatsappBridgeSetup] QR code conversion error:', error);
            dispatch(setWhatsappError('Failed to generate QR code'));
            dispatch(setWhatsappSetupState('error'));
          });
        } else if (data.state === 'connected') {
          logger.info('[WhatsappBridgeSetup] Whatsapp connected via socket event');
          dispatch(setWhatsappSetupState('connected'));
          dispatch(setWhatsappConnected(true));
          if (data.bridgeRoomId) {
            dispatch(setBridgeRoomId(data.bridgeRoomId));
          }
          
          // CRITICAL FIX: Stop the QR code timer and polling
          stopTimer();
          stopPolling();

          // Dispatch platform-connection-changed event to update UI components
          if (session?.user?.id) {
            window.dispatchEvent(new CustomEvent('platform-connection-changed', {
              detail: {
                platform: 'whatsapp',
                isActive: true,
                timestamp: Date.now()
              }
            }));
            logger.info('[WhatsappBridgeSetup] Dispatched platform-connection-changed event for socket status update');
            
            // Set WhatsApp as the active platform in localStorage
            localStorage.setItem('dailyfix_active_platform', 'whatsapp');
            logger.info('[WhatsappBridgeSetup] Set whatsapp as active platform in localStorage');
          }

          // Call onComplete callback if provided
          if (onComplete && typeof onComplete === 'function') {
            if (shouldAllowCompleteTransition()) {
              onComplete();
            }
          }
        }
      });

      // Listen for Whatsapp status updates
      socket.on('Whatsapp:status', (data: any) => {
        logger.info('[WhatsappBridgeSetup] Received Whatsapp status update:', data);

        if (data.status === 'active') {
          logger.info('[WhatsappBridgeSetup] Whatsapp connected via status update');
          dispatch(setWhatsappSetupState('connected'));
          dispatch(setWhatsappConnected(true));
          if (data.bridgeRoomId) {
            dispatch(setBridgeRoomId(data.bridgeRoomId));
          }
          
          // CRITICAL FIX: Stop the QR code timer and polling
          stopTimer();
          stopPolling();

          // Use localStorage as a fallback for Whatsapp connection status
          if (session?.user?.id) {
            saveWhatsAppStatus(true, session.user.id);
            logger.info('[WhatsappBridgeSetup] Saved Whatsapp connection status to localStorage via socket event');
            
            // Dispatch platform-connection-changed event to update UI components
            window.dispatchEvent(new CustomEvent('platform-connection-changed', {
              detail: {
                platform: 'whatsapp',
                isActive: true,
                timestamp: Date.now()
              }
            }));
            logger.info('[WhatsappBridgeSetup] Dispatched platform-connection-changed event for status update');
            
            // Set WhatsApp as the active platform in localStorage
            localStorage.setItem('dailyfix_active_platform', 'whatsapp');
            logger.info('[WhatsappBridgeSetup] Set whatsapp as active platform in localStorage');
          }

          // Call onComplete callback if provided
          if (onComplete && typeof onComplete === 'function') {
            if (shouldAllowCompleteTransition()) {
              onComplete();
            }
          }
        }
      });

      return () => {
        logger.info('[WhatsappBridgeSetup] Socket listeners removed');
        socket.off('Whatsapp:qr'); // Add this to properly clean up the new listener
        socket.off('Whatsapp:setup:status');
        socket.off('Whatsapp:status');
      };
    }
  }, [socket, isConnected, session, dispatch, onComplete, startQrTimer, stopTimer, stopPolling]);

  // Reset all flags when component mounts to ensure a fresh start
  useEffect(() => {
    // Track global mount count for debugging
    GLOBAL_INIT_STATE.mountCount++;
    mountTimeRef.current = Date.now();
    GLOBAL_INIT_STATE.mountTime = mountTimeRef.current;
    
    logger.info(`[WhatsappBridgeSetup] Component mounted (count: ${GLOBAL_INIT_STATE.mountCount}), initiating connection`);
    
    // CRITICAL FIX: Add a delay to let the component "settle" before initialization
    const stabilityTimer = setTimeout(() => {
      stableComponentRef.current = true;
      
      // CRITICAL FIX: Check if we should use existing initialization or start new
      if (GLOBAL_INIT_STATE.isInitializing && Date.now() - GLOBAL_INIT_STATE.lastInitAttempt < 5000) {
        logger.info('[WhatsappBridgeSetup] Component stable, but initialization recently started - skipping');
        return;
      }
      
      // CRITICAL FIX: Check if initialization is already in progress
      if (initializationRef.current) {
        logger.info('[WhatsappBridgeSetup] Initialization already in progress, skipping useEffect');
        return;
      }
      
      // CRITICAL FIX: Add throttling to prevent too many attempts
      const lastAttempt = GLOBAL_INIT_STATE.lastInitAttempt;
      const timeSinceLastAttempt = Date.now() - lastAttempt;
      if (lastAttempt > 0 && timeSinceLastAttempt < 3000) {
        logger.info(`[WhatsappBridgeSetup] Too many attempts (${timeSinceLastAttempt}ms since last), throttling`);
        return;
      }

      // Wrap in try-catch to handle any errors
      try {
        logger.info('[WhatsappBridgeSetup] Component stable, starting initialization');
        initializeConnection();
      } catch (error) {
        logger.error('[WhatsappBridgeSetup] Error initiating connection:', error);
        dispatch(setWhatsappError('Failed to connect to Whatsapp. Please try again.'));
        dispatch(setWhatsappSetupState('error'));
        // Clear initialization flags
        initializationRef.current = false;
        GLOBAL_INIT_STATE.isInitializing = false;
      }
    }, 1000); // 1000ms delay to ensure component is stable

    // Set mounted flag and handle cleanup
    return () => {
      clearTimeout(stabilityTimer);
      // Clear initialization flag on unmount
      initializationRef.current = false;
      logger.info(`[WhatsappBridgeSetup] Component unmount cleanup after ${Date.now() - mountTimeRef.current}ms - initialization flag cleared`);
    };
  }, [dispatch, initializeConnection]); // Only run once on mount

  // Set mounted flag and handle cleanup
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (!qrReceivedRef.current) {
        dispatch(resetWhatsappSetup());
      }

      // CRITICAL FIX: Force stop both polling and timer on unmount
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      // Clear session storage initialization key
      sessionStorage.removeItem(Whatsapp_INIT_KEY);

      // Log cleanup
      logger.info('[WhatsappBridgeSetup] Component unmounted, polling and timers stopped');
    };
  }, [dispatch]);

  // Helper function to format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Determine content based on state
  let content = null;

  if (isInitializing || reduxLoading) {
    content = (
      <Card className="max-w-md mx-auto border-gray-800 bg-black/60">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-white">Connecting to Whatsapp</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6">
          <LavaLamp className="w-[60px] h-[120px] mb-4" />
          <p className="text-gray-300">Initializing Whatsapp connection...</p>
          <p className="text-gray-400 text-sm mt-2">This may take a few moments</p>
        </CardContent>
        <CardFooter className="flex justify-center pb-6">
          <Button 
            variant="outline" 
            onClick={() => {
              // CRITICAL FIX: Stop both polling and timer
              stopPolling();
              stopTimer();
              // Clear initialization flag
              initializationRef.current = false;
              // Call onCancel
              onCancel();
            }}
          >
            Cancel
          </Button>
        </CardFooter>
      </Card>
    );
  } else if (qrCode) {
    content = (
      <Card className="max-w-md mx-auto border-gray-800 bg-black/60">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-white">Connect Whatsapp</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center">
          {timeLeft > 0 ? (
            <div className="relative">
              <div className="bg-white p-4 rounded-lg mb-6 inline-block">
                <img
                  src={qrCode}
                  alt="Whatsapp QR Code"
                  className="w-64 h-64"
                  onError={(e) => {
                    logger.error('[WhatsappBridgeSetup] QR code image error:', e);
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              </div>
              <div className={`absolute top-1 right-1 h-8 w-8 flex items-center justify-center rounded-full bg-black/70 border-2 ${timeLeft <= 10 ? 'border-red-500 animate-pulse' : 'border-gray-300'}`}>
                <span className={`text-sm font-bold ${timeLeft <= 10 ? 'text-red-500' : 'text-white'}`}>{timeLeft}</span>
              </div>
            </div>
          ) : (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>QR code expired</AlertTitle>
              <AlertDescription>
                Please refresh the QR code to try again.
              </AlertDescription>
              <Button
                variant="destructive"
                size="sm"
                className="mt-2"
                onClick={handleRetry}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh QR Code
              </Button>
            </Alert>
          )}
          <div className="text-gray-300 mb-4 text-sm space-y-2">
            <p>1. Open Whatsapp on your phone.</p>
            <p>2. Open Linked Devices or settings to link a device.</p>
            <p>3. Point your phone to this screen to scan the code.</p>
          </div>
          
          {timeLeft > 0 && (
            <div className="w-full bg-gray-700 rounded-full h-2.5 mb-4 overflow-hidden">
              <div 
                className={`h-2.5 rounded-full ${timeLeft <= 10 ? 'bg-red-600 animate-pulse' : 'bg-blue-600'}`} 
                style={{width: `${(timeLeft / 35) * 100}%`, transition: 'width 1s linear'}}
              ></div>
            </div>
          )}
          
          {timeLeft > 0 && (
            <p className={`text-sm ${timeLeft <= 10 ? 'text-red-400 font-bold' : 'text-gray-400'}`}>
              QR code expires in {timeLeft} seconds
            </p>
          )}
        </CardContent>
        <CardFooter className="flex justify-center pb-6">
          <Button 
            variant="outline" 
            onClick={() => {
              // CRITICAL FIX: Stop both polling and timer
              stopPolling();
              stopTimer();
              // Clear initialization flag
              initializationRef.current = false;
              // Call onCancel
              onCancel();
            }}
          >
            Cancel
          </Button>
        </CardFooter>
      </Card>
    );
  } else if (setupState === 'error') {
    const errorMessage = reduxError?.message || reduxError || 'Failed to connect Whatsapp';
    const is500Error = errorMessage && (errorMessage.includes('500') || errorMessage.includes('unavailable') || errorMessage.includes('Internal Server Error'));
    
    content = (
      <Card className="max-w-md mx-auto border-gray-800 bg-black/60">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-white">Connection Error</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorMessage message={errorMessage} />
          {showRetryButton && (
            <Button 
              variant="destructive" 
              onClick={handleRetry}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          )}
        </CardContent>
        <CardFooter className="flex justify-center space-x-4 pb-6">
          <Button 
            variant="outline" 
            onClick={() => {
              // CRITICAL FIX: Stop both polling and timer
              stopPolling();
              stopTimer();
              // Clear initialization flag
              initializationRef.current = false;
              // Call onCancel
              onCancel();
            }}
          >
            Cancel
          </Button>
        </CardFooter>
      </Card>
    );
  } else {
    content = (
      <Card className="max-w-md mx-auto border-gray-800 bg-black/60">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-white">Connect Whatsapp</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6">
          <LavaLamp className="w-[60px] h-[120px] mb-4" />
          <p className="text-gray-300">Waiting for QR code...</p>
          <p className="text-gray-400 text-sm mt-2">This may take a few moments</p>
        </CardContent>
        <CardFooter className="flex justify-center pb-6">
          <Button 
            variant="outline" 
            onClick={() => {
              // CRITICAL FIX: Stop both polling and timer
              stopPolling();
              stopTimer();
              // Clear initialization flag
              initializationRef.current = false;
              // Call onCancel
              onCancel();
            }}
          >
            Cancel
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <>
      {content}
    </>
  );
};

// Add PropTypes
WhatsappBridgeSetup.propTypes = {
  onComplete: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  relogin: PropTypes.bool
};

export default WhatsappBridgeSetup;
