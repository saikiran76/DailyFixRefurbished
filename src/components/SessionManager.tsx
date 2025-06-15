
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
import CentralLoader from '@/components/ui/CentralLoader';
import { Button } from '@/components/ui/button';
/**
 * SessionManager component
 * Handles authentication state management and session persistence
 * Provides initialization and restoration of sessions
 */

// Global flag to track initialization to prevent duplicate initializations
// This helps prevent issues with strict mode and hot reloading
let globalInitialized = false;

// List of public routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/signup', '/reset-password', '/auth/callback'];

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

  // Helper function to check if current route is public
  const isPublicRoute = (path: string) => {
    return PUBLIC_ROUTES.some(route => path.startsWith(route));
  };

  // Set up auth state change listener
  useEffect(() => {
    const supabaseClient = getSupabaseClient();
    
    if (!supabaseClient) {
      logger.error('[SessionManager] No Supabase client available for auth state listener');
      return;
    }
    
    // Subscribe to auth state changes
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, session) => {
      logger.info('[SessionManager] Auth state changed:', event);
      
      if (event === 'SIGNED_IN' && session) {
        logger.info('[SessionManager] User signed in');
        dispatch(updateSession({ session }));
        
        // Check for redirect parameter in URL
        const urlParams = new URLSearchParams(window.location.search);
        const redirectPath = urlParams.get('redirect');
        
        if (redirectPath) {
          navigate(redirectPath);
        } else if (location.pathname === '/login') {
          navigate('/dashboard');
        }
      } 
      else if (event === 'SIGNED_OUT') {
        logger.info('[SessionManager] User signed out');
        clearAllSessionData();
        
        // Don't redirect if already on a public route
        if (!isPublicRoute(location.pathname)) {
          // Save current path for redirect after login
          const currentPath = location.pathname;
          navigate(`/login?redirect=${encodeURIComponent(currentPath)}`);
        }
      }
      else if (event === 'TOKEN_REFRESHED') {
        logger.info('[SessionManager] Token refreshed');
      }
    });
    
    // Clean up subscription on unmount
    return () => {
      subscription.unsubscribe();
    };
  }, [dispatch, navigate, location, logger]);

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
          
          // If not on a public route, redirect to login with the current path
          if (!isPublicRoute(location.pathname)) {
            navigate(`/login?redirect=${encodeURIComponent(location.pathname)}`);
          }
        }
        // We have a valid Supabase session but no Redux session, initialize it
        else if (supabaseSession?.session && !currentState.auth.session) {
          // Normalize the session for our Redux store
          const normalizedSession: SessionType = {
            ...supabaseSession.session,
            user: supabaseSession.session.user
          };
          
          // Update Redux state with the normalized session
          dispatch(updateSession({ session: normalizedSession }));
          logger.info('[SessionManager] Session restored from Supabase');
        }
        // Check for Matrix credentials if we have a valid session
        else if (currentState.auth.session && !credentials) {
          // Fetch Matrix credentials if needed
          dispatch(fetchMatrixCredentials());
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
    
    // Handle session updates from API
    const handleSessionUpdated = (event: CustomEvent) => {
      logger.info('[SessionManager] Session updated from API');
      
      // Skip processing if component is unmounted
      if (!mountedRef.current) return;
      
      // Update Redux with the new session
      if (event.detail?.session) {
        dispatch(updateSession({ session: event.detail.session }));
      }
    };
    
    window.addEventListener('auth-state-changed', handleAuthStateChange as EventListener);
    window.addEventListener('session-updated', handleSessionUpdated as EventListener);
    
    return () => {
      window.removeEventListener('auth-state-changed', handleAuthStateChange as EventListener);
      window.removeEventListener('session-updated', handleSessionUpdated as EventListener);
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
    const currentSession = store.getState().auth.session;
    if (currentSession) {
      navigate('/onboarding');
    } else {
      navigate('/login');
    }
  };

  // Render children once validation is complete
  return isValidating ? (
    <div className="relative w-screen h-screen">
      <CentralLoader
        message={getLoaderMessage().main}
        subMessage={getLoaderMessage().sub}
      />
      {isValidating && !initialized && emergencyTimeoutRef.current !== null && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2">
          <Button
            variant="outline"
            onClick={handleManualContinue}
          >
            Continue Manually
          </Button>
        </div>
      )}
    </div>
  ) : (
    <>{children}</>
  );
};

export default SessionManager;
