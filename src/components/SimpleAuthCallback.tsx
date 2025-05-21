import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-hot-toast';
import { getSupabaseClient } from '@/utils/supabase';
import { updateSession, setHasInitialized } from '@/store/slices/authSlice';
import { fetchOnboardingStatus, setCurrentStep, setIsComplete } from '@/store/slices/onboardingSlice';
import { handleGoogleCallback, getAuthRedirectPath } from '@/utils/googleAuth';
import { useLogger } from '@/hooks/useLogger';
import LavaLamp from './ui/Loader/LavaLamp';
import type { AppDispatch } from '@/store';

/**
 * SimpleAuthCallback component
 * Handles the Google OAuth callback and updates the Redux store
 */
const SimpleAuthCallback = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const logger = useLogger();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const processingRef = useRef(false);
  const navigationTimerRef = useRef<any>(null);
  const criticalTimerRef = useRef<any>(null);

  // Select onboarding state from Redux
  const onboardingState = useSelector((state: any) => state.onboarding);
  const authState = useSelector((state: any) => state.auth);
  
  // Super critical escape hatch - if nothing else works, this will
  useEffect(() => {
    criticalTimerRef.current = setTimeout(() => {
      if (loading) {
        logger.error('[SimpleAuthCallback] CRITICAL: Authentication callback has been stuck for 10 seconds');
        logger.info('[SimpleAuthCallback] Current state:', { loading, error, redirecting, processingRef: processingRef.current });
        
        try {
          // Check if we already have a session in the Redux store
          if (authState.session) {
            logger.info('[SimpleAuthCallback] Session exists in Redux, forcing redirect to onboarding');
            
            // Force onboarding state
            dispatch(setCurrentStep('welcome'));
            dispatch(setIsComplete(false));
            
            // Force navigation using window.location (most reliable)
            window.location.href = '/onboarding';
          } else {
            // If no session, go back to login
            logger.warn('[SimpleAuthCallback] No session found, redirecting to login');
            window.location.href = '/login';
          }
        } catch (e) {
          logger.error('[SimpleAuthCallback] Failed to execute critical escape hatch:', e);
          // Last resort - just go to login
          window.location.href = '/login';
        }
      }
    }, 10000); // 10 seconds is more than enough
    
    return () => {
      if (criticalTimerRef.current) {
        clearTimeout(criticalTimerRef.current);
      }
    };
  }, [loading, error, redirecting, authState, dispatch, logger]);
  
  // Force navigation after a timeout if we get stuck
  useEffect(() => {
    const forceNavigationTimeout = setTimeout(() => {
      if (loading && !error && !redirecting) {
        logger.warn('[SimpleAuthCallback] Force navigation timeout triggered');
        setRedirecting(true);
        
        // Force navigation to onboarding after 8 seconds regardless of state
        window.location.href = '/onboarding';
      }
    }, 8000);
    
    return () => clearTimeout(forceNavigationTimeout);
  }, [loading, error, redirecting, logger]);

  useEffect(() => {
    // Prevent multiple parallel processing attempts
    if (processingRef.current) {
      logger.info('[SimpleAuthCallback] Already processing auth, skipping duplicate call');
      return;
    }
    
    processingRef.current = true;
    logger.info('[SimpleAuthCallback] Starting auth processing');
    
    // Clear any existing navigation timers
    if (navigationTimerRef.current) {
      clearTimeout(navigationTimerRef.current);
      navigationTimerRef.current = null;
    }
    
    const processAuth = async () => {
      try {
        logger.info('[SimpleAuthCallback] Processing auth callback');
        setLoading(true);

        // Ensure Supabase client is available
        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error('Authentication service is not available');
        }

        // Handle the callback from Google OAuth
        const authData = await handleGoogleCallback();

        if (!authData || !authData.session) {
          throw new Error('No session data returned from auth callback');
        }

        logger.info('[SimpleAuthCallback] Received session data:', 
          { userId: authData.session?.user?.id, expires: authData.session?.expires_at });

        // CRITICAL: Use synchronous dispatch pattern with await for all Redux state updates
        await Promise.all([
          // Update Redux store with session data
          dispatch(updateSession({ session: authData.session })),
          dispatch(setHasInitialized(true)),
          // Explicitly set onboarding to not complete to force the onboarding flow
          dispatch(setCurrentStep('welcome')),
          dispatch(setIsComplete(false))
        ]);
        
        logger.info('[SimpleAuthCallback] All Redux state updates completed');

        // Success notification
        toast.success('Successfully signed in!', {
          duration: 3000,
          position: 'top-center',
        });

        setRedirecting(true);
        logger.info('[SimpleAuthCallback] Redirecting to onboarding...');
        
        // MOST CRITICAL FIX: Force browser navigation with a timestamp to break any caching
        const timestamp = new Date().getTime();
        window.location.href = `/onboarding?t=${timestamp}`;
        
      } catch (error: any) {
        logger.error('[SimpleAuthCallback] Error processing auth callback:', error);
        setError(error.message || 'Failed to process authentication');
        
        // Show a more helpful error message
        let errorMessage = 'Authentication failed. Please try again.';
        
        if (error.message?.includes('code verifier')) {
          errorMessage = 'Your sign-in session expired. Please try signing in again.';
        } else if (error.message?.includes('CSRF')) {
          errorMessage = 'Security validation failed. Please try signing in again.';
        } else if (error.message?.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        }
        
        toast.error(errorMessage, {
          duration: 5000,
          position: 'top-center',
        });
        
        // Redirect to login page after error
        window.location.href = '/login';
      } finally {
        setLoading(false);
        processingRef.current = false;
      }
    };

    processAuth();
    
    // Return a cleanup function
    return () => {
      processingRef.current = false;
      if (navigationTimerRef.current) {
        clearTimeout(navigationTimerRef.current);
      }
      if (criticalTimerRef.current) {
        clearTimeout(criticalTimerRef.current);
      }
    };
  }, [dispatch, navigate, logger]);

  // Handle manual retry or navigation
  const handleManualContinue = () => {
    logger.info('[SimpleAuthCallback] Manual navigation triggered by user');
    
    if (error) {
      window.location.href = '/login';
    } else {
      // Check if we have a session in Redux
      const hasSession = !!authState.session;
      
      if (hasSession) {
        logger.info('[SimpleAuthCallback] Session detected, navigating to onboarding');
        // Force the onboarding state
        dispatch(setCurrentStep('welcome'));
        dispatch(setIsComplete(false));
      }
      
      // Force navigation to onboarding
      window.location.href = '/onboarding';
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-black text-white">
      <div className="w-full max-w-md p-8 space-y-6 bg-zinc-900 rounded-lg shadow-lg border border-zinc-800">
        <h2 className="text-2xl font-bold text-center">
          {error ? 'Authentication Error' : (redirecting ? 'Success!' : 'Authenticating...')}
        </h2>
        
        {loading && (
          <div className="flex flex-col items-center justify-center space-y-4">
            <LavaLamp className="w-[60px] h-[120px]" />
            <p className="text-center text-zinc-400">
              {!redirecting ? 'Processing your sign-in...' : 'Preparing onboarding...'}
            </p>
          </div>
        )}
        
        {error && (
          <div className="text-center space-y-4">
            <p className="text-red-500">{error}</p>
            <p className="text-zinc-400">
              You'll be redirected to the login page shortly.
            </p>
          </div>
        )}
        
        {redirecting && !error && (
          <div className="text-center space-y-4">
            <p className="text-green-500">Authentication successful!</p>
            <p className="text-zinc-400">
              Setting up your onboarding process...
            </p>
          </div>
        )}
        
        <button
          onClick={handleManualContinue}
          className="w-full py-2 px-4 bg-white text-black font-medium rounded-md hover:bg-gray-200 focus:outline-none transition-colors"
        >
          {error ? 'Return to Login' : 'Continue to Onboarding'}
        </button>
      </div>
    </div>
  );
};

export default SimpleAuthCallback; 