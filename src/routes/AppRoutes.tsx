import { useEffect, lazy, Suspense, useState, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { useLogger } from '@/hooks/useLogger';
import { clearProblematicStorage } from '@/utils/sessionRecovery';
import { isWhatsAppConnected } from '@/utils/connectionStorage';
import { AuthErrorBoundary } from '@/components/ErrorBoundary';
import { setCurrentStep, setIsComplete, ONBOARDING_STEPS } from '@/store/slices/onboardingSlice';
import Dashboard from '@/pages/Dashboard';
import React from 'react';
import CentralLoader from '@/components/ui/CentralLoader';

// Use lazy loading for performance
const Login = lazy(() => import('@/pages/Login'));
const Signup = lazy(() => import('@/pages/Signup'));
// const Dashboard = lazy(() => import('@/pages/Dashboard'));
const NewOnboarding = lazy(() => import('@/pages/NewOnboarding'));
const ForgotPassword = lazy(() => import('@/pages/Signup').then(module => ({ default: module.ForgotPassword })));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const SimpleAuthCallback = lazy(() => import('@/components/SimpleAuthCallback'));

// Global initialization flag to prevent multiple initializations
let isRouterGloballyInitialized = false;

// Define types for the Redux state
interface AuthState {
  session: any;
}

interface OnboardingState {
  matrixConnected: boolean;
  whatsappConnected: boolean;
  isComplete: boolean;
  currentStep: string;
}

interface RootState {
  auth: AuthState;
  onboarding: OnboardingState;
}

/**
 * AppRoutes component that manages routing based on authentication and onboarding state
 */
const AppRoutes = () => {
  const logger = useLogger();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  
  const { session } = useSelector((state: RootState) => state.auth);
  const { matrixConnected, whatsappConnected, isComplete, currentStep } = useSelector((state: RootState) => state.onboarding);

  // Add state to track navigation attempts
  const [navigationAttempts, setNavigationAttempts] = useState(0);
  const [isRouterInitialized, setIsRouterInitialized] = useState(isRouterGloballyInitialized);
  const [routeTransitioning, setRouteTransitioning] = useState(false);
  const lastInitTimeRef = useRef(Date.now());
  const forceUpdateTimerRef = useRef<any>(null);
  const initializingRef = useRef(false);
  const mountedRef = useRef(false);
  // CRITICAL FIX: Track if we've already processed a navigation to prevent loops
  const previousPathRef = useRef<string | null>(null);
  const redirectProcessedRef = useRef(false);
  
  // CRITICAL FIX: Add a ref to track redirects to prevent infinite loops
  const hasRedirectedRef = useRef<Record<string, boolean>>({});

  // Generate appropriate loading messages based on current route and auth state
  const getLoaderMessage = () => {
    const path = location.pathname;
    
    if (path.includes('/auth/callback')) {
      return {
        main: "Completing authentication...",
        sub: "You'll be redirected in a moment"
      };
    }
    
    if (!session) {
      return {
        main: "Checking authentication...",
        sub: "Please wait while we verify your session"
      };
    }
    
    if (path === '/onboarding' || path.includes('/onboarding/')) {
      return {
        main: "Preparing your onboarding...",
        sub: "Setting up your personalized experience"
      };
    }
    
    if (path === '/dashboard') {
      return {
        main: "Loading your dashboard...",
        sub: "Preparing your personalized workspace"
      };
    }
    
    return {
      main: "Loading...",
      sub: "Please wait while we prepare your experience"
    };
  };

  // Initialization effect runs once
  useEffect(() => {
    // Mark component as mounted
    mountedRef.current = true;
    
    // Skip initialization if already done
    if (isRouterInitialized || isRouterGloballyInitialized || initializingRef.current) {
      logger.info('[AppRoutes] Router already initialized, skipping');
      return;
    }
    
    // Set initializing flag
    initializingRef.current = true;
    lastInitTimeRef.current = Date.now();
    
    // Initialize
    const init = async () => {
      try {
        // CRITICAL FIX: Don't clear localStorage during auth callback
        const isAuthRoute = location.pathname.includes('/auth/callback');
        if (!isAuthRoute) {
          // Clear any problematic localStorage items that might be causing issues
          const clearedItems = clearProblematicStorage();
          if (clearedItems.length > 0) {
            logger.info('[AppRoutes] Cleared problematic localStorage items:', clearedItems);
          }
        } else {
          logger.info('[AppRoutes] On auth route, skipping localStorage cleanup');
        }

        // Log initial routing state for debugging
        logger.info('[AppRoutes] Initial routing state:', {
          pathname: location.pathname,
          hasSession: !!session,
          onboardingComplete: isComplete,
          currentStep
        });
        
        // Set route transitioning to true to show loader
        setRouteTransitioning(true);
        
        // If the user is authenticated but we're at the root route, redirect immediately
        if (session && (location.pathname === '/' || location.pathname === '')) {
          logger.info('[AppRoutes] User is authenticated at root route, redirecting to appropriate page');
          
          if (isComplete) {
            logger.info('[AppRoutes] Onboarding complete, redirecting to dashboard');
            navigate('/dashboard', { replace: true });
          } else {
            logger.info('[AppRoutes] Onboarding not complete, redirecting to onboarding');
            navigate('/onboarding', { replace: true });
          }
        }
      } catch (error) {
        logger.error('[AppRoutes] Error during initialization:', error);
      } finally {
        // Mark router as initialized - both locally and globally
        setIsRouterInitialized(true);
        isRouterGloballyInitialized = true;
        lastInitTimeRef.current = Date.now();
        initializingRef.current = false;
        
        // Give a slight delay before removing the loader to prevent flashing
        setTimeout(() => {
          setRouteTransitioning(false);
        }, 300);
      }
    };

    init();
    
    // Cleanup when component unmounts
    return () => {
      mountedRef.current = false;
      if (forceUpdateTimerRef.current) {
        clearTimeout(forceUpdateTimerRef.current);
        forceUpdateTimerRef.current = null;
      }
    };
  }, [session, isRouterInitialized, navigate, isComplete, location.pathname, logger]);

  // Add deterministic loading state - force initialization after timeout
  useEffect(() => {
    // Only set up timer if not initialized
    if (isRouterInitialized || isRouterGloballyInitialized) {
      return;
    }
    
    // Force initialization after timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      if (!isRouterInitialized && !isRouterGloballyInitialized) {
        logger.warn('[AppRoutes] Router initialization timed out, forcing initialization');
        lastInitTimeRef.current = Date.now();
        setIsRouterInitialized(true);
        isRouterGloballyInitialized = true;
        
        // CRITICAL FIX: If we're stuck and have auth, try to render the right component immediately
        if (session) {
          if (!isComplete && location.pathname === '/onboarding') {
            logger.info('[AppRoutes] Forcing NewOnboarding to render on timeout');
            // The component will render naturally now that isRouterInitialized is true
          }
        }
        
        // Reset route transitioning state
        setRouteTransitioning(false);
      }
    }, 1500);
    
    return () => clearTimeout(timeout);
  }, [isRouterInitialized, logger, session, isComplete, location.pathname]);

  // Listen for route changes to show the loader during transitions
  useEffect(() => {
    // Show the loader when starting a navigation
    setRouteTransitioning(true);
    
    // Hide the loader after a short delay
    const timer = setTimeout(() => {
      setRouteTransitioning(false);
    }, 1000); // Adjust timing to ensure components have time to load
    
    return () => clearTimeout(timer);
  }, [location.pathname]);

  // Add super robust "last resort" check to force route initialization
  // but make it more reliable to prevent conflicts
  useEffect(() => {
    // If we get stuck and the user is authenticated, force navigation based on state
    if (session && !isRouterInitialized && !isRouterGloballyInitialized && !initializingRef.current) {
      // Only set up timer if we haven't already started initializing
      // Start a timer that will force navigation if isRouterInitialized doesn't change
      forceUpdateTimerRef.current = setTimeout(() => {
        logger.error('[AppRoutes] CRITICAL: Detected stuck state with authentication. Forcing route resolution.');
        
        const now = Date.now();
        const elapsed = now - lastInitTimeRef.current;
        logger.info(`[AppRoutes] Time elapsed since last init attempt: ${elapsed}ms`);
        
        // Only proceed if we're still not initialized
        if (!isRouterInitialized && !isRouterGloballyInitialized) {
          try {
            // Force the onboarding to a known state
            dispatch(setCurrentStep(ONBOARDING_STEPS.WELCOME));
            dispatch(setIsComplete(false));
            
            // Force initialization state to true to prevent getting stuck
            setIsRouterInitialized(true);
            isRouterGloballyInitialized = true;
            
            // Reset route transitioning
            setRouteTransitioning(false);
            
            // Wait a moment before redirecting to ensure state is applied
            setTimeout(() => {
              // CRITICAL: Force a direct navigation based on the path, only if still mounted
              if (mountedRef.current) {
                if (location.pathname === '/' || location.pathname === '') {
                  logger.warn('[AppRoutes] Force redirecting to /onboarding from root path');
                  window.location.href = '/onboarding';
                } else if (location.pathname.includes('/auth/callback')) {
                  logger.warn('[AppRoutes] Auth callback detected, redirecting to onboarding');
                  window.location.href = '/onboarding';
                } else if (location.pathname === '/dashboard' && (!isComplete || currentStep !== ONBOARDING_STEPS.COMPLETE)) {
                  logger.warn('[AppRoutes] Dashboard accessed but onboarding not complete, redirecting');
                  window.location.href = '/onboarding';
                } else if (location.pathname === '/onboarding' && isComplete) {
                  logger.warn('[AppRoutes] Onboarding accessed but already complete, redirecting to dashboard');
                  window.location.href = '/dashboard';
                }
              }
            }, 100);
          } catch (error) {
            logger.error('[AppRoutes] Error during force navigation:', error);
            // Last resort
            if (mountedRef.current) {
              window.location.href = '/login';
            }
          }
        }
      }, 2500); // Increased from 2000ms to 2500ms to allow other timers to complete
      
      return () => {
        if (forceUpdateTimerRef.current) {
          clearTimeout(forceUpdateTimerRef.current);
          forceUpdateTimerRef.current = null;
        }
      };
    }
  }, [session, isRouterInitialized, dispatch, location.pathname, isComplete, currentStep, logger]);

  // Recovery mechanism for WhatsApp connection state from localStorage
  // This serves as a fallback when the backend fails to update the accounts table
  const whatsappConnectedInLocalStorage = session?.user?.id ? isWhatsAppConnected(session.user.id) : false;

  // Debug log to see values - only log when values change to reduce spam
  const lastStateRef = useRef({
    matrixConnected,
    whatsappConnected,
    isComplete,
    currentStep,
    hasSession: !!session,
    pathname: location.pathname
  });

  useEffect(() => {
    const currentState = {
      matrixConnected,
      whatsappConnected,
      isComplete,
      currentStep,
      hasSession: !!session,
      pathname: location.pathname
    };
    
    // Only log if something important changed
    if (JSON.stringify(currentState) !== JSON.stringify(lastStateRef.current)) {
      logger.info('[AppRoutes] Onboarding state values:', {
        ...currentState,
        whatsappConnectedInLocalStorage,
        navigationAttempts
      });
      
      // Update ref
      lastStateRef.current = currentState;
    }
  }, [
    matrixConnected, 
    whatsappConnected, 
    isComplete, 
    currentStep, 
    session, 
    whatsappConnectedInLocalStorage, 
    navigationAttempts, 
    location.pathname,
    logger
  ]);

  // Effect to handle authentication recovery in case the app gets stuck
  useEffect(() => {
    // If we have a session but app is stuck (attempts > 3)
    if (session && navigationAttempts > 3) {
      logger.warn('[AppRoutes] Multiple navigation attempts detected, forcing onboarding step');
      
      try {
        // Force the onboarding state to a known good state
        dispatch(setCurrentStep(ONBOARDING_STEPS.WELCOME));
        dispatch(setIsComplete(false));
        
        // Don't show toast here to avoid infinite toast spam
        
        // CRITICAL FIX: Use window.location to break React Router navigation loop
        // Only redirect if not already on onboarding page to prevent reload loop
        if (location.pathname !== '/onboarding') {
          logger.warn('[AppRoutes] Force navigating to /onboarding with window.location');
          window.location.href = '/onboarding';
        } else {
          logger.info('[AppRoutes] Already on /onboarding, not redirecting again');
        }
      } catch (error) {
        logger.error('[AppRoutes] Error during recovery navigation:', error);
      }
      
      // Reset navigation attempts
      setNavigationAttempts(0);
    }
  }, [navigationAttempts, session, dispatch, logger, location.pathname]);

  // CRITICAL FIX: New effect to stop the navigation loop when we're already on onboarding
  useEffect(() => {
    if (
      session && 
      !isComplete && 
      location.pathname === '/onboarding' && 
      navigationAttempts > 0
    ) {
      logger.info('[AppRoutes] Already on correct route (/onboarding), resetting navigation attempts');
      setNavigationAttempts(0);
    }
  }, [session, isComplete, location.pathname, navigationAttempts, logger]);

  // Helper function to determine where to redirect after login/signup
  const getPostAuthRedirect = () => {
    // CRITICAL FIX: Don't use this function directly for Navigation components
    // Only use for manual navigation or cases where we need to determine the path
    const currentPath = location.pathname;
    
    // If we don't have a session, always go to login
    if (!session) {
      return '/login';
    }

    // If onboarding is complete, go to dashboard
    if (isComplete) {
      return '/dashboard';
    }

    // If we're already on the onboarding page, don't redirect again
    if (currentPath === '/onboarding') {
      return currentPath; // Stay on current path
    }

    // Otherwise, go to onboarding
    return '/onboarding';
  };

  // CRITICAL FIX: Replace the original route rendering with memoized paths
  // Use useMemo to prevent recalculating routes on every render
  const authRedirectPath = React.useMemo(() => {
    const path = session ? (isComplete ? '/dashboard' : '/onboarding') : '/login';
    
    // Only log navigation intent without incrementing on every render
    const currentPath = location.pathname;
    
    // CRITICAL FIX: Only log and increment navigation attempts if this is a new path
    if (path !== currentPath && previousPathRef.current !== currentPath) {
      logger.info(`[AppRoutes] Path resolution: ${path} (current: ${currentPath})`);
      
      // Update the previous path reference
      previousPathRef.current = currentPath;
      
      // Reset the redirect processed flag when we're on a new path
      if (!redirectProcessedRef.current) {
        // Only increment navigation attempts once per path
        setNavigationAttempts(prev => Math.min(prev + 1, 5));
        redirectProcessedRef.current = true;
      }
    }
    
    return path;
  }, [session, isComplete, location.pathname, logger]);
  
  // Reset the redirect state when navigation completes
  useEffect(() => {
    if (location.pathname === authRedirectPath && navigationAttempts > 0) {
      // We've successfully navigated to the target path
      logger.info(`[AppRoutes] Successfully navigated to ${location.pathname}, resetting navigation state`);
      setNavigationAttempts(0);
      redirectProcessedRef.current = false;
    }
  }, [location.pathname, authRedirectPath, navigationAttempts, logger]);

  // Show global loader based on route transitioning or router initialization
  const showGlobalLoader = !isRouterInitialized || routeTransitioning;
  
  // Get appropriate loader message
  const loaderMessages = getLoaderMessage();

  // Show the centralized loader when router is not initialized or during route transitions
  if (showGlobalLoader) {
    return (
      <CentralLoader 
        message={loaderMessages.main}
        subMessage={loaderMessages.sub}
        showButton={navigationAttempts > 2}
        buttonText="Continue Manually"
        onButtonClick={() => {
          setIsRouterInitialized(true);
          isRouterGloballyInitialized = true;
          setRouteTransitioning(false);
          
          // Determine where to navigate based on auth state
          const redirectPath = session ? 
            (isComplete ? '/dashboard' : '/onboarding') : 
            '/login';
            
          window.location.href = redirectPath;
        }}
      />
    );
  }

  // Create a consistent suspense fallback using our centralized loader
  const renderLazy = (Component: React.LazyExoticComponent<any>) => (
    <Suspense fallback={<CentralLoader message="Loading..." />}>
      <AuthErrorBoundary>
        <Component />
      </AuthErrorBoundary>
    </Suspense>
  );

  return (
    <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={
          session ? <Navigate to={authRedirectPath} replace /> : renderLazy(Login)
        }
      />

      <Route
        path="/signup"
        element={
          session ? <Navigate to={authRedirectPath} replace /> : renderLazy(Signup)
        }
      />

      <Route path="/forgot-password" element={renderLazy(ForgotPassword)} />
      <Route path="/reset-password" element={renderLazy(ResetPassword)} />

      {/* Auth Callback Routes - Wrapped with specific error handling */}
      <Route
        path="/auth/google/callback"
        element={
          <Suspense fallback={
            <CentralLoader 
              message="Processing authentication..." 
              subMessage="Completing your Google sign-in"
            />
          }>
            <AuthErrorBoundary>
              <SimpleAuthCallback />
            </AuthErrorBoundary>
          </Suspense>
        }
      />
      <Route
        path="/auth/callback"
        element={
          <Suspense fallback={
            <CentralLoader 
              message="Processing authentication..." 
              subMessage="Please wait while we complete your sign-in"
            />
          }>
            <AuthErrorBoundary>
              <SimpleAuthCallback />
            </AuthErrorBoundary>
          </Suspense>
        }
      />

      {/* Protected Routes */}
      <Route
        path="/dashboard"
        element={
          !session ? (
            // If we don't have a session, redirect to login
            <Navigate to="/login" replace />
          ) : !isComplete ? (
            // If onboarding is not complete, redirect to onboarding
            <Navigate to="/onboarding" replace />
          ) : (
            // If we have a session and onboarding is complete, show the dashboard
            <AuthErrorBoundary>
              <Dashboard />
            </AuthErrorBoundary>
          )
        }
      />

      {/* Onboarding Routes */}
      <Route
        path="/onboarding"
        element={
          !session ? (
            <Navigate to="/login" replace />
          ) : isComplete ? (
            // If onboarding is complete, redirect to dashboard
            <Navigate to="/dashboard" replace />
          ) : (
            // CRITICAL FIX: Use conditional component to prevent unnecessary redirects
            isRouterInitialized ? (
              renderLazy(NewOnboarding)
            ) : (
              <CentralLoader
                message="Preparing onboarding..."
                subMessage="Setting up your personalized experience"
              />
            )
          )
        }
      />

      {/* Keep the original onboarding route for backward compatibility */}
      <Route
        path="/onboarding/:step"
        element={
          !session ? (
            <Navigate to="/login" replace />
          ) : isComplete ? (
            // If onboarding is complete, redirect to dashboard
            <Navigate to="/dashboard" replace />
          ) : (
            // CRITICAL FIX: Use renderLazy consistently for the same component
            isRouterInitialized ? (
              renderLazy(NewOnboarding)
            ) : (
              <CentralLoader
                message="Preparing onboarding..."
                subMessage="Setting up your personalized experience"
              />
            )
          )
        }
      />

      {/* Default Route */}
      <Route
        path="*"
        element={
          session === null ? (
            <Navigate to="/login" replace />
          ) : isComplete ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Navigate to="/onboarding" replace />
          )
        }
      />
    </Routes>
  );
};

export default AppRoutes; 