import { supabase } from '../utils/supabase';
import { tokenManager } from '../utils/tokenManager';
import logger from '../utils/logger';
import { store } from '../store/store';
import { updateSession } from '../store/slices/authSlice';
import { getGoogleAuthUrl } from '../utils/googleAuth';

logger.info('AuthService module loaded');

class AuthService {
    constructor() {
        this.initialized = false;
        this.initPromise = null;
        this.lastSessionCheck = 0;
        this.SESSION_CHECK_COOLDOWN = 5000; // 5 seconds
        this.SESSION_EXPIRY_HOURS = 5; // 5 hours session persistence
    }

    // Helper method to standardize session storage
    async storeSessionData(session) {
        if (!session?.access_token || !session?.refresh_token || !session?.user) {
            throw new Error('Invalid session data for storage');
        }

        // Calculate expiry time (current time + SESSION_EXPIRY_HOURS)
        const expiryTime = new Date();
        expiryTime.setHours(expiryTime.getHours() + this.SESSION_EXPIRY_HOURS);

        // Use the session's expires_at if available, otherwise use our calculated expiry
        const expires_at = session.expires_at || expiryTime.toISOString();

        const storageData = {
            session: {
                access_token: session.access_token,
                refresh_token: session.refresh_token,
                expires_at: expires_at,
                provider_token: session.provider_token,
                provider_refresh_token: session.provider_refresh_token,
                user: session.user
            },
            user: session.user,
            // Add last_active timestamp for session tracking
            last_active: new Date().toISOString()
        };

        try {
            // Store main session data
            localStorage.setItem('dailyfix_auth', JSON.stringify(storageData));

            // Also store access token separately for API calls
            localStorage.setItem('access_token', session.access_token);

            // Store session expiry for quick access
            localStorage.setItem('session_expiry', expires_at);

            const { data: accounts, error } = await supabase
                            .from('accounts')
                            .select('*')
                            .eq('user_id', session.user.id)
                            .eq('platform', 'matrix')
                            .maybeSingle();

            // If Matrix credentials exist, store them separately
            if (!error && accounts) {
                const matrixCreds = accounts.credentials;
                localStorage.setItem('matrix_credentials', JSON.stringify(matrixCreds));
                logger.info('[AuthService] Matrix credentials stored successfully');
            }

            // Update store only after successful storage
            store.dispatch(updateSession({ session }));
            logger.info('[AuthService] Session stored successfully, expires:', expires_at);
            return true;
        } catch (error) {
            logger.error('[AuthService] Failed to store session data:', error);
            return false;
        }
    }

    // Helper method to clear session data
    clearSessionData(clearCredentials = false) {
        try {
            localStorage.removeItem('dailyfix_auth');
            localStorage.removeItem('access_token');
            localStorage.removeItem('session_expiry');
            localStorage.removeItem('matrix_credentials');

            // CRITICAL FIX: Only clear stored credentials on explicit logout
            // This allows us to recover from token refresh failures
            if (clearCredentials) {
                localStorage.removeItem('dailyfix_credentials');
                logger.info('[AuthService] Stored credentials cleared');
            }

            tokenManager.clearTokens();
            store.dispatch(updateSession({ session: null }));
            logger.info('[AuthService] Session data cleared successfully');
        } catch (error) {
            logger.error('[AuthService] Error clearing session data:', error);
        }
    }

    async initialize() {
        if (this.initPromise) {
            return this.initPromise;
        }

        try {
            this.initPromise = (async () => {
                if (this.initialized) {
                    return;
                }

                // Set up auth state change listener
                supabase.auth.onAuthStateChange(async (event, session) => {
                    logger.info('[AuthService] Auth state changed:', event);

                    if (event === 'SIGNED_IN' && session) {
                        await this.storeSessionData(session);
                    } else if (event === 'SIGNED_OUT') {
                        this.clearSessionData();
                    }
                });

                // Initial session check
                await this.validateSession();
                this.initialized = true;
            })();

            return await this.initPromise;
        } catch (error) {
            logger.error('[AuthService] Initialization error:', error);
            throw error;
        } finally {
            this.initPromise = null;
        }
    }

    async validateSession(force = false) {
        try {
            // Check cooldown unless forced
            if (!force && Date.now() - this.lastSessionCheck < this.SESSION_CHECK_COOLDOWN) {
                logger.info('[AuthService] Session check cooldown active');
                return null;
            }
            this.lastSessionCheck = Date.now();

            // First try to get token from storage
            const authDataStr = localStorage.getItem('dailyfix_auth');
            if (authDataStr) {
                try {
                    const authData = JSON.parse(authDataStr);

                    // Check if session is still valid based on expiry time
                    const expiryStr = authData.session?.expires_at || localStorage.getItem('session_expiry');
                    const now = new Date();
                    const expiryTime = expiryStr ? new Date(expiryStr) : null;

                    // If we have a valid expiry time and it's in the future, session is still valid
                    const isSessionValid = expiryTime && expiryTime > now;

                    logger.info('[AuthService] Session expiry check:', {
                        hasExpiry: !!expiryTime,
                        expiryTime: expiryTime?.toISOString(),
                        now: now.toISOString(),
                        isValid: isSessionValid
                    });

                    if (authData.session?.access_token && authData.user) {
                        // If session is still valid by our expiry check, try to validate the token
                        if (isSessionValid) {
                            try {
                                // Validate the stored token
                                const { data: { user }, error: validateError } = await supabase.auth.getUser(authData.session.access_token);
                                if (!validateError && user) {
                                    logger.info('[AuthService] Using stored token - validation successful');

                                    // Update last_active timestamp
                                    authData.last_active = new Date().toISOString();
                                    localStorage.setItem('dailyfix_auth', JSON.stringify(authData));

                                    // Return the session
                                    return {
                                        session: authData.session,
                                        user: user // Use fresh user data from validation
                                    };
                                }
                            } catch (tokenError) {
                                logger.warn('[AuthService] Token validation failed:', tokenError);
                                // Continue to refresh attempt
                            }
                        } else {
                            logger.info('[AuthService] Session expired, attempting refresh');
                        }
                    }
                } catch (parseError) {
                    logger.error('[AuthService] Error parsing stored auth data:', parseError);
                    this.clearSessionData(); // Clear invalid data
                }
            }

            // Get current session from Supabase
            const { data: { session }, error } = await supabase.auth.getSession();
            if (error) {
                logger.error('[AuthService] Session validation error:', error);
                this.clearSessionData();
                return null;
            }

            if (!session) {
                // Try to refresh session
                const { data: { session: refreshedSession }, error: refreshError } =
                    await supabase.auth.refreshSession();

                if (refreshError || !refreshedSession) {
                    logger.error('[AuthService] Session refresh failed:', refreshError);
                    this.clearSessionData();
                    return null;
                }

                // Store refreshed session
                await this.storeSessionData(refreshedSession);
                return refreshedSession;
            }

            // Store current valid session
            await this.storeSessionData(session);
            return session;
        } catch (error) {
            logger.error('[AuthService] Session validation error:', error);
            this.clearSessionData();
            return null;
        }
    }

    // Securely store credentials for token refresh recovery
    async storeCredentials(email, password) {
        try {
            // CRITICAL FIX: Store credentials securely for token refresh recovery
            // This is used as a last resort when refresh tokens are invalidated
            const credentials = {
                email,
                password,
                timestamp: Date.now()
            };

            // Store credentials in localStorage
            localStorage.setItem('dailyfix_credentials', JSON.stringify(credentials));
            logger.info('[AuthService] Credentials stored for recovery');
            return true;
        } catch (error) {
            logger.error('[AuthService] Error storing credentials:', error);
            return false;
        }
    }

    async signIn(email, password) {
        try {
            const { data: { session }, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            // Validate session before storing
            if (!session || !session.user || !session.access_token) {
                throw new Error('Invalid session data received');
            }

            // Validate the token immediately
            const { data: { user }, error: validateError } = await supabase.auth.getUser(session.access_token);
            if (validateError || !user) {
                throw new Error('Session validation failed');
            }

            // Store validated session data
            const success = await this.storeSessionData(session);
            if (!success) {
                throw new Error('Failed to store session data');
            }

            // CRITICAL FIX: Store credentials for token refresh recovery
            // Only store if we have both email and password
            if (email && password) {
                await this.storeCredentials(email, password);
            }

            return { session, user };
        } catch (error) {
            logger.error('[AuthService] Sign in error:', error);
            // Clear any partial session data
            this.clearSessionData();
            throw error;
        }
    }

    async signOut() {
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            // CRITICAL FIX: Clear credentials on explicit logout
            this.clearSessionData(true);
            logger.info('[AuthService] User signed out successfully');
        } catch (error) {
            logger.error('[AuthService] Sign out error:', error);
            // Even if the API call fails, clear local data
            this.clearSessionData(true);
            throw error;
        }
    }

    async getGoogleSignInUrl() {
        try {
            return await getGoogleAuthUrl();
        } catch (error) {
            logger.error('[AuthService] Error getting Google sign-in URL:', error);
            throw error;
        }
    }

    // Process Google OAuth session
    async processGoogleSession(session) {
        try {
            if (!session) {
                throw new Error('No session provided');
            }

            // Store the session
            await this.storeSessionData(session);

            // Check if this is a new user
            const createdAt = new Date(session.user.created_at);
            const lastSignIn = new Date(session.user.last_sign_in_at);
            const isNewUser = Math.abs(createdAt - lastSignIn) < 60000; // Within 1 minute

            return {
                session,
                user: session.user,
                isNewUser
            };
        } catch (error) {
            logger.error('[AuthService] Google session processing error:', error);
            throw error;
        }
    }
}

const authService = new AuthService();
export default authService;