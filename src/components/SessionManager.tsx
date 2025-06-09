import { useEffect, useState, useRef } from 'react';
import type { ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { updateSession, clearAuth } from '@/store/slices/authSlice';
import { fetchMatrixCredentials } from '@/store/slices/matrixSlice';
import { supabase, getSupabaseClient } from '@/utils/supabase';
import authService from '@/services/authService';
import { useLogger } from '@/hooks/useLogger';
import { useStore } from 'react-redux';
import type { RootState, AppDispatch } from '@/store/store';
import { refreshTokenIfNeeded } from '@/utils/authSecurityHelpers';
import { SupabaseClient } from '@supabase/supabase-js';
// import LavaLamp from '@/components/ui/Loader/LavaLamp';
import CentralLoader from '@/components/ui/CentralLoader';
// import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
/**
 * SessionManager component
 * Handles authentication state management and session persistence
 * Provides initialization and restoration of sessions
 */

// Global flag to track initialization to prevent duplicate initializations
// This helps prevent issues with strict mode and hot reloading
let globalInitialized = false;

interface SessionManagerProps {
  children: ReactNode;
}

// Define a type for the auth data stored in localStorage
interface StoredAuthData {
  access_token: string;
  refresh_token?: string;
  user: {
    id: string;
    [key: string]: any;
  };
  expires_at?: number;
}

// Define the normalized auth data structure
interface NormalizedAuthData {
  accessToken: string;
  refreshToken?: string;
  user: {
    id: string;
    [key: string]: any;
  };
  expiresAt: number | null;
}

// Define the session type
interface SessionType {
  user: {
    id: string;
    [key: string]: any;
  };
  [key: string]: any;
}

// Get auth state from Redux store
const getAuthSession = (state: RootState) => state.auth.session;

const SessionManager = ({ children }: SessionManagerProps) => {
  const logger = useLogger();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const location = useLocation();
  const store = useStore<RootState>();
  
  const [isValidating, setIsValidating] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const isInitializingRef = useRef(false);
  const mountedRef = useRef(false);
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emergencyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Use the session from Redux store as our single source of truth
  const session = useSelector(getAuthSession);
  const { credentials } = useSelector((state: RootState) => state.matrix);
  
  // Helper function to clear all session data
  const clearAllSessionData = () => {
    // Only clear if we actually have something to clear
    const currentState = store.getState();
    if (!currentState.auth.session) {
      logger.info('[SessionManager] No session to clear, skipping clearAllSessionData');
      return;
    }
    
    // Clear Redux session
    dispatch(clearAuth());
    
    // Clear localStorage auth data
    localStorage.removeItem('dailyfix_auth');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('token_expires_at');
    localStorage.removeItem('user_data');
    localStorage.removeItem('auth_timestamp');
    logger.info('[SessionManager] All session data cleared');
  };

  // CRITICAL FIX: Add emergency timeout to prevent infinite initialization
  useEffect(() => {
    // Only set up emergency timeout if we're validating and not initialized
    if (isValidating && !initialized) {
      logger.info('[SessionManager] Setting up emergency timeout');
      
      emergencyTimeoutRef.current = setTimeout(() => {
        // If still validating after timeout, force complete
        if (isValidating && !initialized) {
          logger.warn('[SessionManager] Emergency timeout triggered after 5000ms - forcing initialization complete');
          
          // Force cleanup of initializing state
          isInitializingRef.current = false;
          
          // Complete validation
          setIsValidating(false);
          setInitialized(true);
          globalInitialized = true;
          
          // Log session state to help with debugging
          const authState = store.getState().auth;
          logger.info('[SessionManager] Auth state at emergency completion:', { 
            hasSession: !!authState.session,
            onAuthRoute: location.pathname.includes('/auth/')
          });
        }
      }, 5000); // 5 second timeout
      
      return () => {
        if (emergencyTimeoutRef.current) {
          clearTimeout(emergencyTimeoutRef.current);
          emergencyTimeoutRef.current = null;
        }
      };
    }
  }, [isValidating, initialized, logger, location.pathname, store]);

  // Initialize auth state on component mount
  useEffect(() => {
    // Mark component as mounted
    mountedRef.current = true;
    
    // Skip if already initialized globally or during validation
    if (initialized || globalInitialized) {
      logger.info('[SessionManager] Already initialized, skipping');
      
      // Still need to mark validation as complete for the component to render
      if (isValidating) {
        setIsValidating(false);
      }
      return;
    }
    
    // Skip if already initializing
    if (isInitializingRef.current) {
      logger.info('[SessionManager] Initialization already in progress, skipping');
      return;
    }
  
    // Set initializing flag
    isInitializingRef.current = true;
    
    // Use debounce to prevent multiple rapid initializations
    if (initTimerRef.current) {
      clearTimeout(initTimerRef.current);
    }
    
    // Debounce initialization to prevent duplicate calls
    initTimerRef.current = setTimeout(async () => {
      try {
        logger.info('[SessionManager] Initializing auth state');

        // Helper function to normalize auth data
        const normalizeAuthData = (): NormalizedAuthData | null => {
          try {
            // Check for stored auth data in localStorage
            const authDataStr = localStorage.getItem('dailyfix_auth');
            if (!authDataStr) return null;

            // Parse the stored data
            const authData = JSON.parse(authDataStr) as StoredAuthData;
            if (!authData || !authData.access_token || !authData.user || !authData.user.id) {
              logger.warn('[SessionManager] Invalid auth data in localStorage, removing');
              localStorage.removeItem('dailyfix_auth');
              return null;
            }

            return {
              accessToken: authData.access_token,
              refreshToken: authData.refresh_token,
              user: authData.user,
              expiresAt: authData.expires_at || null
            };
          } catch (error) {
            logger.error('[SessionManager] Error normalizing auth data:', error);
            localStorage.removeItem('dailyfix_auth');
            return null;
          }
        };

        // Check for auth data in localStorage
        const authData = normalizeAuthData();
        const currentState = store.getState();
        const isAuthRoute = location.pathname.includes('/auth/callback');
        
        // Skip further processing if we're on an auth callback route
        if (isAuthRoute) {
          logger.info('[SessionManager] On auth callback route, skipping session initialization');
          setIsValidating(false);
          setInitialized(true);
          globalInitialized = true;
          return;
        }

        // Ensure we have a valid Supabase client
        const supabaseClient: SupabaseClient | null = getSupabaseClient();
        if (!supabaseClient) {
          logger.error('[SessionManager] Supabase client is not initialized');
          clearAllSessionData();
          setIsValidating(false);
          setInitialized(true);
          globalInitialized = true;
          return;
        }

        // Verify session with Supabase first - this is critical
        const { data: supabaseSession, error: supabaseError } = await supabaseClient.auth.getSession();
        
        // If Supabase has no valid session, clear any stored data to prevent the phantom session issue
        if (!supabaseSession?.session || supabaseError) {
          // Only log once to prevent spam
          if (!globalInitialized) {
            logger.warn('[SessionManager] No valid Supabase session found', { 
              hasSupabaseSession: !!supabaseSession?.session,
              hasReduxSession: !!currentState.auth.session,
              hasLocalStorage: !!authData,
              error: supabaseError
            });
          }
          
          // Only clear if we actually have something to clear
          if (currentState.auth.session) {
            // Clear all session data to prevent phantom sessions
            clearAllSessionData();
          }
          
          setIsValidating(false);
          setInitialized(true);
          globalInitialized = true;
          return;
        }
        
        // If we reach here, Supabase has a valid session
        
        // If we have a stored session in Redux, validate and fetch what we need
        if (currentState.auth.session) {
          // Safely cast to our session type
          const currentSession = currentState.auth.session as SessionType;
          
          if (currentSession.user) {
            const user = currentSession.user;
            
            logger.info('[SessionManager] Using existing session from Redux store for user:', user.id);
            
            // Make sure the session in Redux matches Supabase session
            if (supabaseSession?.session?.user?.id !== user.id) {
              logger.warn('[SessionManager] Session mismatch between Redux and Supabase, clearing');
              clearAllSessionData();
              setIsValidating(false);
              setInitialized(true);
              globalInitialized = true;
              return;
            }
            
            // Session matches, refresh token if needed
            try {
              await refreshTokenIfNeeded();
              
              // Fetch Matrix credentials if needed (for Matrix/Telegram features)
              if (user.id && !credentials) {
                logger.info('[SessionManager] Fetching Matrix credentials for user:', user.id);
                // Use any parameter for now, we'll fix the MatrixSlice later if needed
                dispatch(fetchMatrixCredentials(user.id as any));
              }
            } catch (refreshError: any) {
              logger.error('[SessionManager] Error refreshing token:', refreshError);
              
              // Only clear if we believe this error is auth-related
              if (refreshError.toString().includes('token') || 
                  refreshError.toString().includes('auth') || 
                  refreshError.toString().includes('session')) {
                clearAllSessionData();
              }
            }
            
            logger.info('[SessionManager] Session data stored in Redux store');
          }
        }
        // Otherwise, try to restore from localStorage if we have a valid Supabase session
        else if (authData && authData.user && authData.user.id) {
          try {
            // Verify the user ID matches the Supabase session
            if (supabaseSession?.session?.user?.id !== authData.user.id) {
              logger.warn('[SessionManager] User ID mismatch between localStorage and Supabase session');
              clearAllSessionData();
              setIsValidating(false);
              setInitialized(true);
              globalInitialized = true;
              return;
            }
            
            logger.info('[SessionManager] Restoring session from localStorage for user:', authData.user.id);
            
            // Update Redux store with auth data from localStorage
            dispatch(updateSession({ session: {
              user: authData.user,
              access_token: authData.accessToken,
              refresh_token: authData.refreshToken || '',
              expires_at: authData.expiresAt || undefined
            }}));
            
            // Fetch Matrix credentials if needed
            if (authData.user.id && !credentials) {
              logger.info('[SessionManager] Fetching Matrix credentials for user:', authData.user.id);
              dispatch(fetchMatrixCredentials(authData.user.id as any));
            }
            
            setIsValidating(false);
          } catch (err) {
            logger.error('[SessionManager] Session restoration failed:', err);
            
            // Clear invalid session data
            clearAllSessionData();
            
            // Show error toast if not on login page
            if (location.pathname !== '/login') {
              toast.error('Your session has expired. Please log in again.');
              
              // Dispatch session expiration event
              window.dispatchEvent(new CustomEvent('sessionExpired', {
                detail: { 
                  reason: 'Session validation failed', 
                  redirectUrl: `/login?redirect=${encodeURIComponent(location.pathname)}`
                }
              }));
            }
            
            setIsValidating(false);
          }
        } else {
          // No stored session, nothing to validate
          logger.info('[SessionManager] No stored session found');
          setIsValidating(false);
        }
        
        // Set initialized flags
        setInitialized(true);
        globalInitialized = true;
      } catch (error) {
        logger.error('[SessionManager] Error during auth initialization:', error);
        clearAllSessionData();
        setIsValidating(false);
        setInitialized(true);
        globalInitialized = true;
      } finally {
        // CRITICAL FIX: Always clear initializing flag
        isInitializingRef.current = false;
      }
    }, 300); // Increased debounce from 100ms to 300ms to prevent rapid reinitializations

    // Cleanup function to clear timer and flag
    return () => {
      mountedRef.current = false;
      
      // Clear init timer
      if (initTimerRef.current) {
        clearTimeout(initTimerRef.current);
        initTimerRef.current = null;
      }
      
      // Clear emergency timeout
      if (emergencyTimeoutRef.current) {
        clearTimeout(emergencyTimeoutRef.current);
        emergencyTimeoutRef.current = null;
      }
      
      // Ensure initializing flag is reset on unmount
      isInitializingRef.current = false;
    };
  // Reduced dependency array to minimize re-runs
  }, [dispatch, navigate, location.pathname, logger, credentials]);

  // Set up listener for auth state changes
  useEffect(() => {
    const handleAuthStateChange = (event: CustomEvent) => {
      logger.info('[SessionExpirationHandler] Auth state changed:', event.detail.event);
      
      // Skip processing if component is unmounted
      if (!mountedRef.current) return;
      
      // Clear session on signOut events
      if (event.detail.event === 'SIGNED_OUT') {
        clearAllSessionData();
      }
    };
    
    window.addEventListener('auth-state-changed', handleAuthStateChange as EventListener);
    
    return () => {
      window.removeEventListener('auth-state-changed', handleAuthStateChange as EventListener);
    };
  }, [logger, dispatch]);

  // Get the appropriate loading message based on the current route
  const getLoaderMessage = () => {
    if (location.pathname.includes('/auth/')) {
      return {
        main: "Processing authentication...",
        sub: "Please wait while we secure your session"
      };
    }
    
    return {
      main: "Initializing application...",
      sub: "Please wait while we load your session"
    };
  };

  // Handle manual continue button click
  const handleManualContinue = () => {
    logger.info('[SessionManager] Manual continue triggered by user');
    setIsValidating(false);
    setInitialized(true);
    globalInitialized = true;
    
    // Navigate based on auth state
    if (session) {
      navigate('/onboarding');
    } else {
      navigate('/login');
    }
  };

  // Render children once validation is complete
  return isValidating ? (
    <CentralLoader
      message={getLoaderMessage().main}
      subMessage={getLoaderMessage().sub}
      showButton={isValidating && !initialized && emergencyTimeoutRef.current !== null}
      buttonText="Continue Manually"
      onButtonClick={handleManualContinue}
    />
  ) : (
    <>{children}</>
  );
};

export default SessionManager; 