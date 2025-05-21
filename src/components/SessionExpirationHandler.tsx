import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { updateSession } from '@/store/slices/authSlice';
import { getSupabaseClient } from '@/utils/supabase';
import { useLogger } from '@/hooks/useLogger';
import { 
  refreshTokenIfNeeded, 
  isTokenExpiring, 
  setupTokenRefreshTimer 
} from '@/utils/authSecurityHelpers';
import type { RootState } from '@/store/store';

/**
 * SessionExpirationHandler
 * 
 * Manages session expiration events and token refresh
 * Helps prevent session loss during use
 */
const SessionExpirationHandler = () => {
  const logger = useLogger();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const mountedRef = useRef(false);
  const refreshAttemptedRef = useRef(false);
  
  // Get session state from Redux
  const { session } = useSelector((state: RootState) => state.auth);

  // Handle token refreshing and session events
  useEffect(() => {
    // Mark as mounted
    mountedRef.current = true;
    
    // Skip token refresh setup if we don't have a session
    if (!session) {
      logger.info('[SessionExpirationHandler] No active session, skipping token refresh setup');
      return;
    }
    
    logger.info('[SessionExpirationHandler] Setting up token handling');

    // Get the Supabase client
    const supabase = getSupabaseClient();
    if (!supabase) {
      logger.error('[SessionExpirationHandler] Supabase client not initialized');
      return;
    }

    // Set up interval to check tokens - only if we have a session
    const refreshIntervalId = setupTokenRefreshTimer(5); // Check every 5 minutes
    
    // Watch for global token-related events
    const handleSupabaseSessionUpdated = () => {
      logger.info('[SessionExpirationHandler] Detected Supabase session update');
    };

    const handleSupabaseSessionRemoved = () => {
      logger.info('[SessionExpirationHandler] Detected Supabase session removal');
      
      // Clear the redux store
      dispatch(updateSession({ session: null }));
    };

    const handleSessionExpired = (event: CustomEvent) => {
      // Skip if component unmounted
      if (!mountedRef.current) return;
      
      logger.info('[SessionExpirationHandler] Session expired event received:', event.detail);
      
      // Only attempt refresh if we haven't already tried recently
      if (!refreshAttemptedRef.current) {
        refreshAttemptedRef.current = true;
        
        // Try one final refresh
        refreshTokenIfNeeded().then(() => {
          // Set a timeout to allow another refresh attempt after 30 seconds
          setTimeout(() => {
            refreshAttemptedRef.current = false;
          }, 30000);
          
          // Get current session from Supabase
          supabase.auth.getSession().then(({ data }) => {
            if (!data.session) {
              // If no session, redirect to login
              const redirectUrl = event.detail?.redirectUrl || '/login';
              logger.info(`[SessionExpirationHandler] No valid session, redirecting to ${redirectUrl}`);
              
              // Clear Redux store
              dispatch(updateSession({ session: null }));
              
              // Navigate to login
              navigate(redirectUrl);
            }
          });
        });
      }
    };

    // Set up Supabase auth state change listener
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      // Skip if component unmounted
      if (!mountedRef.current) return;
      
      logger.info('[SessionExpirationHandler] Auth state changed:', event);
      
      if (event === 'SIGNED_OUT') {
        logger.info('[SessionExpirationHandler] User signed out, redirecting to login');
        dispatch(updateSession({ session: null }));
        navigate('/login');
      } else if (event === 'TOKEN_REFRESHED') {
        logger.info('[SessionExpirationHandler] Token refreshed');
        if (session) {
          dispatch(updateSession({ session }));
        }
      }
    });

    // Set up event listeners
    window.addEventListener('supabase-session-updated', handleSupabaseSessionUpdated);
    window.addEventListener('supabase-session-removed', handleSupabaseSessionRemoved);
    window.addEventListener('sessionExpired', handleSessionExpired as EventListener);

    // Initialize by checking if token needs refresh - only for existing session
    if (session?.expires_at) {
      (async () => {
        if (isTokenExpiring(session.expires_at)) {
          logger.info('[SessionExpirationHandler] Token is expiring on init, refreshing');
          await refreshTokenIfNeeded();
        }
      })();
    }

    // Cleanup when unmounting
    return () => {
      // Mark as unmounted
      mountedRef.current = false;
      
      logger.info('[SessionExpirationHandler] Cleaning up token handling');
      window.removeEventListener('supabase-session-updated', handleSupabaseSessionUpdated);
      window.removeEventListener('supabase-session-removed', handleSupabaseSessionRemoved);
      window.removeEventListener('sessionExpired', handleSessionExpired as EventListener);
      
      clearInterval(refreshIntervalId);
      
      // Unsubscribe from auth listener
      if (authListener && authListener.subscription) {
        authListener.subscription.unsubscribe();
      }
    };
  }, [dispatch, navigate, logger, session]);

  // No UI to render
  return null;
};

export default SessionExpirationHandler; 