import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { updateSession } from '@/store/slices/authSlice';
import { fetchOnboardingStatus, setWhatsappConnected } from '@/store/slices/onboardingSlice';
import { getSupabaseClient } from '@/utils/supabase';
import tokenManager from '@/utils/tokenManager';
import { useLogger } from '@/hooks/useLogger';
import { toast } from 'react-hot-toast';
import LavaLamp from './ui/Loader/LavaLamp';
import type { AppDispatch } from '@/store';

/**
 * DirectAuthCallback component
 * Handles the callback from Google OAuth
 */
const DirectAuthCallback = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const logger = useLogger();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const processCallback = async () => {
      try {
        setLoading(true);
        logger.info('[DirectAuthCallback] Processing Google authentication callback');
        
        // Get the Supabase client
        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error('Authentication service is not available');
        }
        
        // Log the full URL to understand what's happening
        logger.info('[DirectAuthCallback] Current URL:', window.location.href);
        logger.info('[DirectAuthCallback] Current origin:', window.location.origin);

        // Get the parameters from the URL
        const urlParams = new URLSearchParams(window.location.search);
        const accessToken = urlParams.get('access_token');
        const refreshToken = urlParams.get('refresh_token');
        const expiresIn = urlParams.get('expires_in');
        const tokenType = urlParams.get('token_type');
        const state = urlParams.get('state');
        const code = urlParams.get('code');

        // Log all URL parameters
        logger.info('[DirectAuthCallback] URL parameters:', {
          accessToken: accessToken ? 'present' : 'missing',
          refreshToken: refreshToken ? 'present' : 'missing',
          expiresIn: expiresIn,
          tokenType: tokenType,
          state: state,
          code: code ? 'present' : 'missing'
        });

        let sessionData = null;

        // For implicit flow, we should get the tokens directly in the URL
        if (accessToken) {
          logger.info('[DirectAuthCallback] Found access token in URL, using implicit flow');

          // Verify the state parameter if available
          const storedState = localStorage.getItem('supabase_auth_state');
          if (state && storedState && state !== storedState) {
            logger.error('[DirectAuthCallback] State mismatch, possible CSRF attack');
            throw new Error('Authentication failed: state mismatch');
          }

          // Set the session directly
          const { data, error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || ''
          });

          if (setSessionError) {
            logger.error('[DirectAuthCallback] Error setting session:', setSessionError);
            throw new Error('Failed to set session');
          }

          if (!data || !data.session) {
            logger.error('[DirectAuthCallback] No session returned from setSession');
            throw new Error('No session returned from authentication provider');
          }
          
          sessionData = data;
        } else if (code) {
          // Code exchange flow
          logger.info('[DirectAuthCallback] Found code in URL, using authorization code flow');

          // Try to exchange the code for a session
          try {
            logger.info('[DirectAuthCallback] Attempting to exchange code for session');
            const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

            if (exchangeError) {
              logger.error('[DirectAuthCallback] Error exchanging code for session:', exchangeError);
            } else if (exchangeData?.session) {
              logger.info('[DirectAuthCallback] Successfully exchanged code for session');
              sessionData = exchangeData;
            }
          } catch (exchangeError) {
            logger.error('[DirectAuthCallback] Exception exchanging code for session:', exchangeError);
          }

          // If code exchange failed, try getting the session directly
          if (!sessionData) {
            const { data, error: getSessionError } = await supabase.auth.getSession();

            if (getSessionError) {
              logger.error('[DirectAuthCallback] Error getting session:', getSessionError);
            } else if (data?.session) {
              sessionData = data;
            } else {
              throw new Error('Failed to get session');
            }
          }
        } else {
          // No code or token found
          logger.error('[DirectAuthCallback] No code or access token found in URL');
          throw new Error('No authorization code or access token found in URL');
        }

        // Final verification that we have a valid session
        if (!sessionData || !sessionData.session) {
          logger.error('[DirectAuthCallback] No valid session obtained after auth flow');
          throw new Error('No valid session obtained');
        }

        // Validate that we have a real user with email
        if (!sessionData.session.user || !sessionData.session.user.email) {
          logger.error('[DirectAuthCallback] Invalid user data in session');
          throw new Error('Invalid user data in session');
        }

        logger.info('[DirectAuthCallback] User authenticated:', {
          id: sessionData.session.user.id,
          email: sessionData.session.user.email,
          provider: sessionData.session.user.app_metadata?.provider
        });

        // Ensure we have a refresh token
        if (!sessionData.session.refresh_token) {
          logger.warn('[DirectAuthCallback] No refresh token in session, attempting to get one');

          // Try to get a refresh token from Supabase
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

          if (refreshError || !refreshData?.session?.refresh_token) {
            logger.error('[DirectAuthCallback] Failed to get refresh token:', refreshError);
          } else {
            // Update session with refresh token
            sessionData = refreshData;
            logger.info('[DirectAuthCallback] Successfully obtained refresh token');
          }
        }

        // Store tokens in localStorage
        if (sessionData.session) {
          localStorage.setItem('access_token', sessionData.session.access_token);
          localStorage.setItem('refresh_token', sessionData.session.refresh_token || '');
          
          const expiresAt = typeof sessionData.session.expires_at === 'string' 
            ? sessionData.session.expires_at 
            : String(sessionData.session.expires_at || Math.floor(Date.now() / 1000) + 3600);
            
          localStorage.setItem('token_expires_at', expiresAt);

          // Set the token in tokenManager
          tokenManager.setToken({
            accessToken: sessionData.session.access_token,
            refreshToken: sessionData.session.refresh_token || '',
            expiresAt: typeof sessionData.session.expires_at === 'string'
              ? parseInt(sessionData.session.expires_at)
              : (sessionData.session.expires_at || Math.floor(Date.now() / 1000) + 3600)
          });
        }

        // Update Redux store with session data
        dispatch(updateSession({ session: sessionData.session }));
        
        // Check if WhatsApp is connected in localStorage
        let whatsappConnected = false;
        try {
          const connectionData = localStorage.getItem('dailyfix_connection_status');
          if (connectionData) {
            const parsedData = JSON.parse(connectionData);
            if (parsedData.status && parsedData.status.whatsapp) {
              whatsappConnected = true;
            }
          }
        } catch (error) {
          logger.error('[DirectAuthCallback] Error checking WhatsApp connection status:', error);
        }
        
        // Set WhatsApp connection status in Redux
        dispatch(setWhatsappConnected(whatsappConnected));
        
        // Fetch onboarding status to know where to redirect
        try {
          await dispatch(fetchOnboardingStatus());
          logger.info('[DirectAuthCallback] Fetched onboarding status');
        } catch (onboardingError) {
          logger.error('[DirectAuthCallback] Failed to fetch onboarding status:', onboardingError);
          // Continue despite error
        }

        // Success notification
        toast.success('Successfully signed in!');
        
        // Get redirect path from localStorage or use default
        const redirectTo = localStorage.getItem('auth_redirect') || '/dashboard';
        localStorage.removeItem('auth_redirect'); // Clear after reading
        
        // Redirect with a slight delay to allow Redux to update
        setTimeout(() => {
          logger.info(`[DirectAuthCallback] Redirecting to ${redirectTo}`);
          navigate(redirectTo, { replace: true });
        }, 500);
      } catch (error: any) {
        logger.error('[DirectAuthCallback] Error processing auth callback:', error);
        setError(error.message || 'Authentication failed');
        
        // Redirect to login page after error
        setTimeout(() => {
          navigate('/login', { replace: true });
        }, 2000);
      } finally {
        setLoading(false);
      }
    };

    processCallback();
  }, [dispatch, navigate, logger]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black p-4 text-white">
      <div className="w-full max-w-md p-8 space-y-6 rounded-lg bg-zinc-900 border border-zinc-800">
        <h2 className="text-2xl font-bold text-center">
          {error ? 'Authentication Error' : 'Authenticating...'}
        </h2>
        
        {loading && (
          <div className="flex flex-col items-center justify-center space-y-4 py-6">
            <LavaLamp className="w-[60px] h-[120px]" />
            <p className="text-center text-zinc-400">
              Processing your sign-in. Please wait...
            </p>
          </div>
        )}
        
        {error && !loading && (
          <div className="text-center space-y-4 py-6">
            <div className="text-red-500">{error}</div>
            <p className="text-zinc-400">
              Redirecting to login page...
            </p>
          </div>
        )}
        
        {!loading && !error && (
          <div className="text-center space-y-4 py-6">
            <div className="text-green-500">Authentication successful!</div>
            <p className="text-zinc-400">
              Redirecting you to your dashboard...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DirectAuthCallback; 