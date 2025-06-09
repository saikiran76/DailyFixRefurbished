import { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useSocketConnection } from '@/hooks/useSocketConnection';
import api from '@/utils/api';  // Our configured axios instance
import QRCode from 'qrcode';
import logger from '@/utils/logger';
import { toast } from 'react-toastify';
// EMERGENCY FIX: Removed supabase import to prevent infinite reload
// Use localStorage as a fallback for WhatsApp connection status
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

// CRITICAL FIX: Unique global initialization key with timestamp to prevent collisions
const WHATSAPP_INIT_KEY = 'whatsapp_initializing_' + Date.now();

// CRITICAL FIX: Add global state to track initialization across component instances
const GLOBAL_INIT_STATE = {
  isInitializing: false,
  lastInitAttempt: 0,
  mountCount: 0,
  mountTime: 0
};

const WhatsAppBridgeSetup = ({ onComplete, onCancel, relogin = false }) => {
  const dispatch = useDispatch();
  const { socket, isConnected } = useSocketConnection('matrix');
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
  const pollIntervalRef = useRef(null);
  
  // CRITICAL FIX: Add timer ref and interval
  const timerIntervalRef = useRef(null);
  const initializationRef = useRef(false);

  // CRITICAL FIX: Add stable mount tracking
  const mountTimeRef = useRef(Date.now());
  const stableComponentRef = useRef(false);

  // Stop polling function - defined first to avoid circular dependency
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      logger.info('[WhatsAppBridgeSetup] Stopping polling for WhatsApp login status');
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      setIsPolling(false);
    }
  }, []);
  
  // CRITICAL FIX: Stop timer function
  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      logger.info('[WhatsAppBridgeSetup] Stopping QR code timer');
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // Function to poll the WhatsApp login status
  const checkLoginStatus = useCallback(async () => {
    try {
      logger.info('[WhatsAppBridgeSetup] Polling WhatsApp login status...');
      const response = await api.get('/api/v1/matrix/whatsapp/status', {
        timeout: 10000 // 10 second timeout to prevent hanging requests
      });

      logger.info('[WhatsAppBridgeSetup] Status response:', response.data);

      // Check if WhatsApp is connected
      if (response.data?.status === 'active') {
        logger.info('[WhatsAppBridgeSetup] Login status poll successful - WhatsApp connected!', response.data);

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

        // Use localStorage as a fallback for WhatsApp connection status
        if (session?.user?.id) {
          saveWhatsAppStatus(true, session.user.id);
          logger.info('[WhatsAppBridgeSetup] Saved WhatsApp connection status to localStorage');
        }
        logger.info('[WhatsAppBridgeSetup] WhatsApp connection detected');

        // Call onComplete callback if provided
        if (onComplete && typeof onComplete === 'function') {
          if (shouldAllowCompleteTransition()) {
            onComplete();
          }
        }
      }
    } catch (error) {
      logger.error('[WhatsAppBridgeSetup] Error polling login status:', error);
    }
  }, [dispatch, onComplete, stopPolling, stopTimer, session]);

  // Start polling
  const startPolling = useCallback(() => {
    if (!isPolling && !pollIntervalRef.current) {
      logger.info('[WhatsAppBridgeSetup] Starting polling for WhatsApp login status');
      setIsPolling(true);
      // Run once immediately
      checkLoginStatus();
      // Then set up interval
      const interval = setInterval(checkLoginStatus, 2000); // Poll every 2 seconds
      pollIntervalRef.current = interval;

      // Set a timeout to stop polling after 5 minutes (300 seconds) to prevent infinite polling
      setTimeout(() => {
        if (pollIntervalRef.current === interval) {
          logger.info('[WhatsAppBridgeSetup] Stopping polling after timeout');
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
      logger.info('[WhatsAppBridgeSetup] Starting QR code timer');
      
      // Start with 60 seconds (1 minute) for QR code validity
      dispatch(setWhatsappTimeLeft(60));
      
      const interval = setInterval(() => {
        dispatch(setWhatsappTimeLeft((prev) => {
          const newTime = prev - 1;
          if (newTime <= 0) {
            logger.info('[WhatsAppBridgeSetup] QR code expired');
            clearInterval(interval);
            timerIntervalRef.current = null;
            return 0;
          }
          return newTime;
        }));
      }, 1000);
      
      timerIntervalRef.current = interval;
    }
  }, [dispatch]);

  // Track if component is mounted
  const isMountedRef = useRef(true);

  // Initialize connection to WhatsApp with retry logic
  const initializeConnection = useCallback(() => {
    // CRITICAL FIX: Check global initialization state to prevent duplicate calls across remounts
    if (GLOBAL_INIT_STATE.isInitializing) {
      logger.info('[WhatsAppBridgeSetup] Global initialization already in progress, skipping duplicate call');
      return;
    }

    // CRITICAL FIX: Check if component is "stable" (mounted for at least 300ms)
    const componentAge = Date.now() - mountTimeRef.current;
    if (componentAge < 300) {
      logger.info(`[WhatsAppBridgeSetup] Component too young (${componentAge}ms), delaying initialization`);
      setTimeout(() => {
        // Only proceed if still mounted
        if (isMountedRef.current) {
          logger.info('[WhatsAppBridgeSetup] Component stabilized, now initializing');
          initializeConnection();
        } else {
          logger.info('[WhatsAppBridgeSetup] Component unmounted during stabilization period');
          GLOBAL_INIT_STATE.isInitializing = false;
        }
      }, 500 - componentAge); // Wait until we've been mounted for at least 500ms
      return;
    }

    // CRITICAL FIX: Check if initialization is already in progress for this instance
    if (initializationRef.current) {
      logger.info('[WhatsAppBridgeSetup] Initialization already in progress, skipping duplicate call');
      return;
    }
    
    // Set initialization flags
    initializationRef.current = true;
    GLOBAL_INIT_STATE.isInitializing = true;
    GLOBAL_INIT_STATE.lastInitAttempt = Date.now();
    
    logger.info('[WhatsAppBridgeSetup] Initializing WhatsApp connection, attempt:', retryCount + 1);
    setIsInitializing(true);

    // Set a flag in sessionStorage to track initialization
    const initKey = WHATSAPP_INIT_KEY;
    sessionStorage.setItem(initKey, 'true');

    // Calculate backoff delay (exponential: 1s, 2s, 4s, etc.)
    const backoffDelay = retryCount > 0 ? Math.pow(2, retryCount - 1) * 1000 : 0;

    // If this is a retry, wait before making the request
    setTimeout(() => {
      // CRITICAL FIX: Double-check we're still mounted
      if (!isMountedRef.current) {
        logger.info('[WhatsAppBridgeSetup] Component unmounted during initialization delay, aborting');
        GLOBAL_INIT_STATE.isInitializing = false;
        sessionStorage.removeItem(initKey);
        return;
      }
      
      // CRITICAL FIX: Ensure we have a valid token before proceeding
      const verifyToken = async () => {
        try {
          // Enhanced debugging - Log the start of token verification
          logger.info('[WhatsAppBridgeSetup] Starting token verification process');
          
          // Check if we have tokens available
          const accessToken = localStorage.getItem('access_token');
          const refreshToken = localStorage.getItem('refresh_token');
          
          // Log token availability (masked for security)
          logger.info('[WhatsAppBridgeSetup] Token check:', { 
            hasAccessToken: !!accessToken, 
            hasRefreshToken: !!refreshToken,
            accessTokenLength: accessToken ? accessToken.length : 0
          });
          
          if (!accessToken && !refreshToken) {
            logger.error('[WhatsAppBridgeSetup] No auth tokens found');
            throw new Error('Authentication required');
          }
          
          // Return the existing token if available
          if (accessToken) {
            logger.info('[WhatsAppBridgeSetup] Using existing access token');
            return accessToken;
          } else if (refreshToken) {
            // Try to refresh the token
            logger.info('[WhatsAppBridgeSetup] Attempting to refresh token');
            const supabase = getSupabaseClient();
            if (!supabase) {
              throw new Error('Supabase client not available');
            }
            
            const { data, error } = await supabase.auth.refreshSession({
              refresh_token: refreshToken
            });
            
            if (error) {
              logger.error('[WhatsAppBridgeSetup] Token refresh failed:', error);
              throw error;
            }
            
            if (data?.session?.access_token) {
              // Store the new access token
              localStorage.setItem('access_token', data.session.access_token);
              logger.info('[WhatsAppBridgeSetup] Token refreshed successfully');
              return data.session.access_token;
            }
          }
          
          throw new Error('Failed to get valid token');
        } catch (error) {
          logger.error('[WhatsAppBridgeSetup] Token verification failed:', error);
          return null;
        }
      };
      
      // Validate token first, then make the request
      verifyToken().then(token => {
        if (!token) {
          // Handle auth error when no token is available
          logger.error('[WhatsAppBridgeSetup] Authentication error, no valid token');
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
        logger.info('[WhatsAppBridgeSetup] Authorization header set with token');

        // DEBUGGING: Log API instance state
        logger.info('[WhatsAppBridgeSetup] API instance details:', {
          baseURL: api.defaults.baseURL,
          hasAuthHeader: !!api.defaults.headers.common['Authorization'],
          timeout: api.defaults.timeout
        });

        // Make API call to initialize WhatsApp connection
        logger.info(`[WhatsAppBridgeSetup] Making API call to /api/v1/matrix/whatsapp/connect ${relogin ? 'with relogin flag' : ''}`);
        
        // Create request data/params based on relogin status
        const requestConfig: RequestConfig = {
          timeout: 30000 // 30 second timeout to prevent hanging
        };
        
        // Add login_type parameter if this is a relogin
        if (relogin) {
          requestConfig.params = { login_type: 'relogin' };
        }
        
        // DEBUGGING: Log the exact request being made
        logger.info('[WhatsAppBridgeSetup] Preparing to send request with config:', {
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
              logger.info('[WhatsAppBridgeSetup] WhatsApp setup initialized successfully:', response.data);
              // Only update state if component is still mounted
              if (isMountedRef.current) {
                setIsInitializing(false);
                setRetryCount(0); // Reset retry count on success
              }

              // *** CRITICAL FIX: Process QR code directly from API response if available ***
              if (response.data && response.data.status === 'qr_ready' && response.data.qrCode) {
                logger.info('[WhatsAppBridgeSetup] Processing QR code from API response...');
                QRCode.toDataURL(response.data.qrCode, {
                  errorCorrectionLevel: 'L',
                  margin: 4,
                  width: 256
                })
                .then(qrDataUrl => {
                  logger.info('[WhatsAppBridgeSetup] QR code from API converted successfully');
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
                  logger.error('[WhatsAppBridgeSetup] Error converting QR code:', qrError);
                  dispatch(setWhatsappError('Error generating QR code'));
                  setShowRetryButton(true);
                });
              } else if (response.data && response.data.status === 'connected') {
                // Handle already connected state
                logger.info('[WhatsAppBridgeSetup] WhatsApp already connected according to API response');
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
              logger.error('[WhatsAppBridgeSetup] API call error details:', {
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
                  logger.error('[WhatsAppBridgeSetup] Authentication error:', error);
                  dispatch(setWhatsappError('Authentication error. Please login again.'));
                  
                  // Redirect to login
                  setTimeout(() => {
                    window.location.href = '/login';
                  }, 2000);
                } else {
                  // For other errors, show retry button and increment retry count
                  logger.error('[WhatsAppBridgeSetup] Error initializing WhatsApp connection:', error);
                  dispatch(setWhatsappError('Failed to initialize WhatsApp. Please try again.'));
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
          logger.error('[WhatsAppBridgeSetup] Critical error making API request:', directError);
          
          if (isMountedRef.current) {
            setIsInitializing(false);
            dispatch(setWhatsappError('Critical error initializing WhatsApp. Please try again.'));
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
    logger.info('[WhatsAppBridgeSetup] Retry button clicked');
    setShowRetryButton(false);
    dispatch(resetWhatsappSetup());
    
    // Stop any existing timers
    stopTimer();
    stopPolling();

    // Reinitialize the connection
    initializeConnection();
  }, [dispatch, initializeConnection, stopTimer, stopPolling]);

  // Start polling when QR code is displayed
  useEffect(() => {
    if (qrCode && !isPolling) {
      logger.info('[WhatsAppBridgeSetup] QR code displayed, starting polling');
      qrReceivedRef.current = true;
      startPolling();
      
      // CRITICAL FIX: Also start the QR code timer
      startQrTimer();
    }
  }, [qrCode, startPolling, isPolling, startQrTimer]);

  // Handle socket connection
  useEffect(() => {
    if (socket && isConnected) {
      logger.info('[WhatsAppBridgeSetup] Socket connected, joining room');

      // Join user room for targeted events
      if (session?.user?.id) {
        socket.emit('join', `user:${session.user.id}`);
        logger.info('[WhatsAppBridgeSetup] Joining socket room:', `user:${session.user.id}`);
      }

      // Listen for WhatsApp setup status updates
      socket.on('whatsapp:setup:status', (data) => {
        logger.info('[WhatsAppBridgeSetup] Received WhatsApp setup status update:', data);

        if (data.state === 'qr_ready' && data.qrCode) {
          // Convert QR code to data URL
          QRCode.toDataURL(data.qrCode, {
            errorCorrectionLevel: 'L',
            margin: 4,
            width: 256
          })
          .then(qrDataUrl => {
            logger.info('[WhatsAppBridgeSetup] QR code converted successfully');
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
            logger.error('[WhatsAppBridgeSetup] QR code conversion error:', error);
            dispatch(setWhatsappError('Failed to generate QR code'));
            dispatch(setWhatsappSetupState('error'));
          });
        } else if (data.state === 'connected') {
          logger.info('[WhatsAppBridgeSetup] WhatsApp connected via socket event');
          dispatch(setWhatsappSetupState('connected'));
          dispatch(setWhatsappConnected(true));
          if (data.bridgeRoomId) {
            dispatch(setBridgeRoomId(data.bridgeRoomId));
          }
          
          // CRITICAL FIX: Stop the QR code timer and polling
          stopTimer();
          stopPolling();

          // Call onComplete callback if provided
          if (onComplete && typeof onComplete === 'function') {
            if (shouldAllowCompleteTransition()) {
              onComplete();
            }
          }
        }
      });

      // Listen for WhatsApp status updates
      socket.on('whatsapp:status', (data) => {
        logger.info('[WhatsAppBridgeSetup] Received WhatsApp status update:', data);

        if (data.status === 'active') {
          logger.info('[WhatsAppBridgeSetup] WhatsApp connected via status update');
          dispatch(setWhatsappSetupState('connected'));
          dispatch(setWhatsappConnected(true));
          if (data.bridgeRoomId) {
            dispatch(setBridgeRoomId(data.bridgeRoomId));
          }
          
          // CRITICAL FIX: Stop the QR code timer and polling
          stopTimer();
          stopPolling();

          // Use localStorage as a fallback for WhatsApp connection status
          if (session?.user?.id) {
            saveWhatsAppStatus(true, session.user.id);
            logger.info('[WhatsAppBridgeSetup] Saved WhatsApp connection status to localStorage via socket event');
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
        logger.info('[WhatsAppBridgeSetup] Socket listeners removed');
        socket.off('whatsapp:setup:status');
        socket.off('whatsapp:status');
      };
    }
  }, [socket, isConnected, session, dispatch, onComplete, startQrTimer, stopTimer, stopPolling]);

  // Initiate connection when component mounts
  useEffect(() => {
    // Track global mount count for debugging
    GLOBAL_INIT_STATE.mountCount++;
    mountTimeRef.current = Date.now();
    GLOBAL_INIT_STATE.mountTime = mountTimeRef.current;
    
    logger.info(`[WhatsAppBridgeSetup] Component mounted (count: ${GLOBAL_INIT_STATE.mountCount}), initiating connection`);
    
    // CRITICAL FIX: Add a delay to let the component "settle" before initialization
    const stabilityTimer = setTimeout(() => {
      stableComponentRef.current = true;
      
      // CRITICAL FIX: Check if we should use existing initialization or start new
      if (GLOBAL_INIT_STATE.isInitializing) {
        logger.info('[WhatsAppBridgeSetup] Component stable, but initialization already in progress');
        return;
      }
      
      // CRITICAL FIX: Check if initialization is already in progress
      if (initializationRef.current) {
        logger.info('[WhatsAppBridgeSetup] Initialization already in progress, skipping useEffect');
        return;
      }

      // Wrap in try-catch to handle any errors
      try {
        logger.info('[WhatsAppBridgeSetup] Component stable, starting initialization');
        initializeConnection();
      } catch (error) {
        logger.error('[WhatsAppBridgeSetup] Error initiating connection:', error);
        dispatch(setWhatsappError('Failed to connect to WhatsApp. Please try again.'));
        dispatch(setWhatsappSetupState('error'));
        // Clear initialization flags
        initializationRef.current = false;
        GLOBAL_INIT_STATE.isInitializing = false;
      }
    }, 500); // 500ms delay to ensure component is stable

    // Set mounted flag and handle cleanup
    return () => {
      clearTimeout(stabilityTimer);
      // Clear initialization flag on unmount
      initializationRef.current = false;
      logger.info(`[WhatsAppBridgeSetup] Component unmount cleanup after ${Date.now() - mountTimeRef.current}ms - initialization flag cleared`);
      
      // Don't clear global init flag on unmount as another instance might be about to take over
      // This will be cleared after API call finishes or on error
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
      sessionStorage.removeItem(WHATSAPP_INIT_KEY);

      // Log cleanup
      logger.info('[WhatsAppBridgeSetup] Component unmounted, polling and timers stopped');
    };
  }, [dispatch]);

  // Helper function to format time
  const formatTime = (seconds) => {
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
          <CardTitle className="text-2xl font-bold text-white">Connecting to WhatsApp</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6">
          <LavaLamp className="w-[60px] h-[120px] mb-4" />
          <p className="text-gray-300">Initializing WhatsApp connection...</p>
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
          <CardTitle className="text-2xl font-bold text-white">Connect WhatsApp</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center">
          <div className="bg-white p-4 rounded-lg mb-6 inline-block">
            <img
              src={qrCode}
              alt="WhatsApp QR Code"
              className="w-64 h-64"
              onError={(e) => {
                logger.error('[WhatsAppBridgeSetup] QR code image error:', e);
                e.target.style.display = 'none';
              }}
            />
          </div>
          <div className="text-gray-300 mb-4 text-sm space-y-2">
            <p>1. Open WhatsApp on your phone.</p>
            <p>2. Open Linked Devices or settings to link a device.</p>
            <p>3. Point your phone to this screen to scan the code.</p>
          </div>
          
          {qrExpired && (
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
          
          {timeLeft > 0 && (
            <p className="text-gray-400 text-sm">
              QR code expires in {formatTime(timeLeft)}
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
    const errorMessage = reduxError?.message || reduxError || 'Failed to connect WhatsApp';
    const is500Error = errorMessage && (errorMessage.includes('500') || errorMessage.includes('unavailable') || errorMessage.includes('Internal Server Error'));
    
    content = (
      <Card className="max-w-md mx-auto bg-neutral-900 border-neutral-800">
        <CardHeader>
          <CardTitle className="text-red-500 flex items-center">
            <AlertCircle className="h-5 w-5 mr-2" />
            Connection Error
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorMessage message={errorMessage} />
          {showRetryButton && (
            <Button 
              onClick={handleRetry} 
              variant="default" 
              className="w-full mt-4"
            >
              Retry Connection
            </Button>
          )}
        </CardContent>
        <CardFooter className="flex justify-center space-x-4 pb-6">
          <Button 
            variant="outline" 
            onClick={onCancel}
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
          <CardTitle className="text-2xl font-bold text-white">Connect WhatsApp</CardTitle>
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
    <div className="w-full max-w-md mx-auto p-4 bg-black rounded-lg border border-gray-800 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-white">WhatsApp Connection</h2>
        <button 
          onClick={onCancel} 
          className="text-gray-400 hover:text-white"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Error Display */}
      {reduxError && (
        <div className="mb-4">
          <ErrorMessage message={reduxError} />
          {showRetryButton && (
            <button
              onClick={handleRetry}
              className="mt-4 w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
            >
              Retry Connection
            </button>
          )}
        </div>
      )}

      {/* QR Code Display */}
      {setupState === 'qr_ready' && qrCode && (
        <div className="flex flex-col items-center space-y-4">
          <p className="text-white text-center">
            Scan this QR code with your WhatsApp mobile app to connect
          </p>
          <div className="bg-white p-2 rounded">
            <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
          </div>
          <div className="text-yellow-400 text-sm flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>QR code expires in {formatTime(timeLeft)}</span>
          </div>
        </div>
      )}

      {/* Connection Status */}
      {setupState === 'connecting' && (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto mb-4"></div>
          <p className="text-white">Connecting to WhatsApp...</p>
        </div>
      )}

      {/* Connected Status */}
      {setupState === 'connected' && (
        <div className="text-center py-4">
          <div className="bg-green-500 rounded-full p-2 w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-green-400 text-lg font-medium mb-2">Successfully Connected</p>
          <p className="text-white mb-4">Your WhatsApp account is now connected.</p>
          <button
            onClick={onComplete}
            className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Initializing Status */}
      {isInitializing && !qrCode && setupState !== 'connected' && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto mb-4"></div>
          <p className="text-white">Initializing WhatsApp connection...</p>
        </div>
      )}

      {showRetryButton && (
        <div className="mt-4 text-xs text-gray-400 p-3 bg-gray-900 rounded">
          <p className="mb-2"><strong>Note:</strong></p>
          <p>If you're unable to connect, please ensure your device is connected to the internet and try again later.</p>
        </div>
      )}
    </div>
  );
};

// Add PropTypes
WhatsAppBridgeSetup.propTypes = {
  onComplete: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  relogin: PropTypes.bool
};

export default WhatsAppBridgeSetup;
