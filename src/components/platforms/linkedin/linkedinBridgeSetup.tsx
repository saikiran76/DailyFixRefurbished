import { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import logger from '@/utils/logger';
import { toast } from 'react-hot-toast';
import { saveLinkedInStatus } from '@/utils/connectionStorage';
import { shouldAllowCompleteTransition } from '@/utils/onboardingFix';
import PropTypes from 'prop-types';
import api from '@/utils/api';
import {
  setLinkedInSetupState,
  setLinkedInError,
  resetLinkedInSetup,
  setLinkedInBridgeRoomId,
  selectLinkedInSetup,
  setLinkedInConnected
} from '@/store/slices/onboardingSlice';
// import { getSupabaseClient } from '@/utils/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Copy,
  ExternalLink,
  Terminal,
  Code,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertCircle,
  Info,
  Check,
  Cookie,
  ChevronRight,
  Dot,
  Linkedin,
  Shield,
  Eye,
  EyeOff
} from 'lucide-react';
import { useSocketConnection } from '@/hooks/useSocketConnection';

// LinkedIn-specific API base URL
const LINKEDIN_API_BASE = 'https://dailyfix-api-gateway.duckdns.org';

// Create LinkedIn-specific API instance using the shared api utility
const createLinkedInApiCall = (endpoint, data = null, method = 'POST') => {
  // Store the original baseURL
  const originalBaseURL = api.defaults.baseURL;
  
  // Temporarily override the baseURL for this request
  api.defaults.baseURL = LINKEDIN_API_BASE;
  
  const config = {
    url: endpoint,
    method,
    ...(data && { data })
  };
  
  // Make the request and restore the original baseURL
  const request = api(config).finally(() => {
    api.defaults.baseURL = originalBaseURL;
  });
  
  return request;
};

// CRITICAL FIX: Add reset function for initialization flags
export function resetLinkedInSetupFlags(forceReset = false) {
  // Only reset if force flag is passed
  if (forceReset) {
    // Clear any session storage keys related to LinkedIn
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith('linkedin_initializing_') || key.startsWith('LinkedIn_initializing_')) {
        sessionStorage.removeItem(key);
      }
    });
    
    // Clear any localStorage keys related to LinkedIn setup
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('linkedin_setup_') || key.startsWith('LinkedIn_setup_')) {
        localStorage.removeItem(key);
      }
    });
    
    logger.info('[LinkedInBridgeSetup] All initialization flags reset');
  }
}

// LinkedIn Bridge Setup Component
const LinkedInBridgeSetup = ({ onComplete, onCancel }) => {
  const dispatch = useDispatch();
  const linkedInSetup = useSelector(selectLinkedInSetup);
  const { socket, isConnected, on } = useSocketConnection('matrix');
  
  const [currentPhase, setCurrentPhase] = useState('instructions'); // instructions, method_selection, waiting, curl_input, cookie_input, connecting, success, error
  const [curlCommand, setCurlCommand] = useState('');
  const [cookieHeader, setCookieHeader] = useState('');
  const [selectedMethod, setSelectedMethod] = useState(null); // 'curl' or 'cookie'
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [bridgeRoomId, setBridgeRoomId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [lastAttemptTime, setLastAttemptTime] = useState(null);
  const [instructions, setInstructions] = useState('');
  
  // ENHANCED: New state variables for intelligent error handling
  const [errorType, setErrorType] = useState(null);
  const [errorGuidance, setErrorGuidance] = useState('');
  const [showDetailedHelp, setShowDetailedHelp] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [curlValidationErrors, setCurlValidationErrors] = useState([]);
  
  // Refs for managing intervals and timeouts
  const statusCheckInterval = useRef(null);
  const connectionTimeout = useRef(null);
  const retryCountdownInterval = useRef(null);
  
  // ENHANCED: Intelligent Socket.IO event handlers
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Listen for cURL/cookie prompt from backend
    const handleCurlPrompt = (data) => {
      logger.info('[LinkedInBridgeSetup] Received authentication prompt via Socket.IO:', data);
      setBridgeRoomId(data.roomId);
      
      // Set the appropriate phase based on login method
      if (data.loginMethod === 'cookie') {
        setCurrentPhase('cookie_input');
      } else {
        setCurrentPhase('curl_input');
      }
      
      dispatch(setLinkedInBridgeRoomId(data.roomId));
    };

    // ENHANCED: Intelligent setup status handler
    const handleSetupStatus = (data) => {
      logger.info('[LinkedInBridgeSetup] Received setup status via Socket.IO:', data);
      
      switch (data.state) {
        case 'curl_prompt':
          setCurrentPhase('curl_input');
          break;
        case 'cookie_prompt':
          setCurrentPhase('cookie_input');
          break;
        case 'curl_submitted':
        case 'cookie_submitted':
          setCurrentPhase('connecting');
          setConnectionStatus('connecting');
          dispatch(setLinkedInSetupState('connecting'));
          break;
        case 'puppet_sent':
          // Keep in connecting state, puppet command sent
          break;
        case 'connected':
          setConnectionStatus('connected');
          setCurrentPhase('success');
          dispatch(setLinkedInConnected(true));
          dispatch(setLinkedInSetupState('completed'));
          saveLinkedInStatus(true);
          
          // Clear all intervals and timeouts
          clearAllTimers();
          
          toast.success('LinkedIn connected successfully!');
          logger.info('[LinkedInBridgeSetup] LinkedIn connection successful via Socket.IO');
          break;
        case 'error':
          // ENHANCED: Intelligent error handling with specific guidance
          handleIntelligentError(data);
          break;
      }
    };

    // Register Socket.IO event listeners using the useSocketConnection's 'on' method
    const cleanupCurlPrompt = on('linkedin:curl-prompt', handleCurlPrompt);
    const cleanupSetupStatus = on('linkedin:setup:status', handleSetupStatus);

    // Cleanup on unmount
    return () => {
      cleanupCurlPrompt();
      cleanupSetupStatus();
    };
  }, [socket, isConnected, dispatch, on]);

  // ENHANCED: Intelligent error handling function
  const handleIntelligentError = useCallback((data) => {
    const { errorType: type, message, guidance } = data;
    
    logger.info('[LinkedInBridgeSetup] Handling intelligent error:', { type, message, guidance });
    
    // Clear any existing timers
    clearAllTimers();
    
    // Set error state
    setErrorMessage(message || 'Connection failed');
    setErrorType(type);
    setErrorGuidance(guidance || '');
    
    // Handle specific error types with tailored UI/UX
    switch (type) {
      case 'invalid_curl_cookies':
        // Missing LinkedIn cookies - guide user to get proper cURL
        setCurrentPhase('curl_input'); // Stay in cURL input phase
        setShowDetailedHelp(true);
        setCurlValidationErrors([
          'Missing required LinkedIn cookies (li_at or JSESSIONID)',
          'Please copy cURL from an active LinkedIn session'
        ]);
        toast.error('Invalid cURL: Missing LinkedIn cookies. Please follow the guide below.');
        break;
        
      case 'invalid_cookie_missing':
        // Missing LinkedIn cookies in cookie header - guide user to get proper cookie
        setCurrentPhase('cookie_input'); // Stay in cookie input phase
        setShowDetailedHelp(true);
        setCurlValidationErrors([
          'Missing required LinkedIn cookies (li_at or JSESSIONID)',
          'Please copy complete Cookie header from an active LinkedIn session'
        ]);
        toast.error('Invalid Cookie: Missing LinkedIn cookies. Please follow the guide below.');
        break;
        
      case 'session_expired':
        // Session expired - guide user to refresh session
        setCurrentPhase(selectedMethod === 'cookie' ? 'cookie_input' : 'curl_input'); // Stay in appropriate input phase
        setShowDetailedHelp(true);
        setCurlValidationErrors([
          'Your LinkedIn session has expired',
          'Please log out and log back into LinkedIn',
          selectedMethod === 'cookie' ? 'Get a fresh Cookie header from the Network tab' : 'Get a fresh cURL command from the Network tab'
        ]);
        toast.error('LinkedIn session expired. Please refresh and try again.');
        break;
        
      case 'malformed_curl':
        // Malformed cURL - guide user to fix format
        setCurrentPhase('curl_input'); // Stay in cURL input phase
        setShowDetailedHelp(true);
        setCurlValidationErrors([
          'The cURL command is incomplete or malformed',
          'Ensure you copy the COMPLETE command with all headers',
          'Look for requests to /voyager/api/messaging/conversations',
          'Use "Copy as cURL (bash)" not "Copy as cURL (cmd)"'
        ]);
        toast.error('Invalid cURL format. Please check the requirements below.');
        break;
        
      case 'malformed_cookie':
        // Malformed cookie - guide user to fix format
        setCurrentPhase('cookie_input'); // Stay in cookie input phase
        setShowDetailedHelp(true);
        setCurlValidationErrors([
          'The Cookie header is incomplete or malformed',
          'Ensure you copy the COMPLETE Cookie header value',
          'Include all cookie values (li_at, JSESSIONID, etc.)',
          'Do not include the "Cookie: " prefix, just the values'
        ]);
        toast.error('Invalid Cookie format. Please check the requirements below.');
        break;
        
      case 'rate_limited':
        // Rate limited - show countdown and prevent immediate retry
        setCurrentPhase(selectedMethod === 'cookie' ? 'cookie_input' : 'curl_input'); // Stay in appropriate input phase
        setShowDetailedHelp(true);
        setRetryCountdown(300); // 5 minutes
        startRetryCountdown();
        setCurlValidationErrors([
          'LinkedIn is rate limiting requests',
          'Please wait 5 minutes before trying again',
          'This is temporary and will resolve automatically'
        ]);
        toast.error('Rate limited. Please wait before retrying.');
        break;
        
      case 'auth_failed':
      case 'login_failed':
      case 'invalid_cookies':
        // General authentication failures - guide user to check account
        setCurrentPhase(selectedMethod === 'cookie' ? 'cookie_input' : 'curl_input'); // Stay in appropriate input phase
        setShowDetailedHelp(true);
        setCurlValidationErrors([
          'Authentication failed with your LinkedIn account',
          'Ensure you are logged into the correct LinkedIn account',
          'Try logging out and back into LinkedIn',
          selectedMethod === 'cookie' ? 'Copy a fresh Cookie header' : 'Copy a fresh cURL command'
        ]);
        toast.error('Authentication failed. Please check your LinkedIn session.');
        break;
        
      case 'network_error':
        // Network issues - allow immediate retry
        setCurrentPhase(selectedMethod === 'cookie' ? 'cookie_input' : 'curl_input'); // Stay in appropriate input phase
        setShowDetailedHelp(true);
        setCurlValidationErrors([
          'Network error occurred during authentication',
          'Check your internet connection',
          'This is usually temporary - try again'
        ]);
        toast.error('Network error. Please check your connection and retry.');
        break;
        
      default:
        // Unknown error - show generic guidance but stay in input phase
        setCurrentPhase(selectedMethod === 'cookie' ? 'cookie_input' : 'curl_input'); // Stay in appropriate input phase
        setShowDetailedHelp(true);
        setCurlValidationErrors([
          'An unexpected error occurred',
          selectedMethod === 'cookie' ? 'Please try with a fresh Cookie header' : 'Please try with a fresh cURL command',
          'Ensure you copied from an active LinkedIn session'
        ]);
        toast.error('Connection failed. Please try again.');
        break;
    }
    
    // Increment attempt counter but don't fail completely
    setConnectionAttempts(prev => prev + 1);
    setConnectionStatus('failed');
    
  }, []);

  // Helper function to clear all timers
  const clearAllTimers = useCallback(() => {
    if (statusCheckInterval.current) {
      clearInterval(statusCheckInterval.current);
      statusCheckInterval.current = null;
    }
    if (connectionTimeout.current) {
      clearTimeout(connectionTimeout.current);
      connectionTimeout.current = null;
    }
    if (retryCountdownInterval.current) {
      clearInterval(retryCountdownInterval.current);
      retryCountdownInterval.current = null;
    }
  }, []);

  // Start retry countdown for rate limiting
  const startRetryCountdown = useCallback(() => {
    if (retryCountdownInterval.current) {
      clearInterval(retryCountdownInterval.current);
    }
    
    retryCountdownInterval.current = setInterval(() => {
      setRetryCountdown(prev => {
        if (prev <= 1) {
          clearInterval(retryCountdownInterval.current);
          setShowDetailedHelp(false);
          setCurlValidationErrors([]);
          toast.success('You can now retry the connection.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Component cleanup
  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, [clearAllTimers]);

  // ENHANCED: Initialize LinkedIn connection
  const initializeConnection = useCallback(async (method = 'curl') => {
    try {
      setIsLoading(true);
      setErrorMessage('');
      setErrorType(null);
      setErrorGuidance('');
      setShowDetailedHelp(false);
      setCurlValidationErrors([]);
      setInstructions('');
      setSelectedMethod(method);
      logger.info('[LinkedInBridgeSetup] Initializing LinkedIn connection (Step 1) with method:', method);
      
      const response = await createLinkedInApiCall('/api/v1/matrix/linkedin/connect', {
        loginMethod: method
      });
      
      if (response.data?.status === 'curl_prompt' || response.data?.status === 'cookie_prompt') {
        const { bridgeRoomId: roomId, message, instructions: newInstructions, loginMethod } = response.data;
        
        if (roomId) {
          setBridgeRoomId(roomId);
          dispatch(setLinkedInBridgeRoomId(roomId));
          logger.info(`[LinkedInBridgeSetup] Received bridgeRoomId: ${roomId}`);
        } else {
          throw new Error("Connection prompt received, but missing 'bridgeRoomId'.");
        }
        
        setInstructions(newInstructions || message || `Paste the ${method === 'cookie' ? 'Cookie header' : 'cURL command'} you copied from your browser's Network tab.`);
        setCurrentPhase(method === 'cookie' ? 'cookie_input' : 'curl_input');
        logger.info(`[LinkedInBridgeSetup] Received ${method} prompt, transitioning to ${method} input phase.`);
        
      } else {
        throw new Error(response.data?.message || 'Failed to initialize LinkedIn connection');
      }
    } catch (error) {
      logger.error('[LinkedInBridgeSetup] Error during initialization (Step 1):', error);
      setErrorMessage(error.response?.data?.message || error.message || 'Failed to initialize connection');
      setCurrentPhase('error');
      dispatch(setLinkedInError(error.message));
    } finally {
      setIsLoading(false);
    }
  }, [dispatch]);

  // ENHANCED: Submit cURL command with intelligent error handling
  const submitCurlCommand = useCallback(async () => {
    if (!curlCommand.trim()) {
      setErrorMessage('Please enter a valid cURL command');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage('');
      setErrorType(null);
      setErrorGuidance('');
      setShowDetailedHelp(false);
      setCurlValidationErrors([]);
      setConnectionAttempts(prev => prev + 1);
      setLastAttemptTime(new Date());
      
      logger.info('[LinkedInBridgeSetup] Submitting cURL command');
      
      const response = await createLinkedInApiCall('/api/v1/matrix/linkedin/connect', {
        curlCommand: curlCommand.trim(),
        bridgeRoomId
      });
      
      if (response.data?.success) {
        // FIX: Check if already connected from cURL submission
        if (response.data?.connected) {
          setCurrentPhase('success');
          setConnectionStatus('connected');
          dispatch(setLinkedInConnected(true));
          dispatch(setLinkedInSetupState('completed'));
          saveLinkedInStatus(true);
          toast.success('LinkedIn connected successfully!');
          logger.info('[LinkedInBridgeSetup] LinkedIn connection successful from cURL submission');
        } else {
          // Set connecting state, Socket.IO will handle the rest
          setCurrentPhase('connecting');
          setConnectionStatus('connecting');
          dispatch(setLinkedInSetupState('connecting'));
          
          // Set connection timeout as fallback
          connectionTimeout.current = setTimeout(() => {
            setErrorMessage('Connection timeout. Please try again.');
            setCurrentPhase('error');
            setConnectionStatus('failed');
          }, 60000); // 1 minute timeout
        }
      } else {
        throw new Error(response.data?.message || 'Failed to process cURL command');
      }
    } catch (error) {
      logger.error('[LinkedInBridgeSetup] Error submitting cURL command:', error);
      
      // ENHANCED: Intelligent backend error detection and handling
      const backendErrorMessage = error.response?.data?.message || error.message || 'Failed to process cURL command';
      
      // Analyze backend error message and map to appropriate error types
      let detectedErrorType = null;
      let userFriendlyMessage = '';
      let validationErrors = [];
      
      if (backendErrorMessage.includes('Missing li_at or JSESSIONID cookie') ||
          backendErrorMessage.includes('li_at') || 
          backendErrorMessage.includes('JSESSIONID') ||
          backendErrorMessage.includes('missing required cookies') ||
          backendErrorMessage.includes('authentication cookies not found')) {
        // Specific LinkedIn cookie missing error
        detectedErrorType = 'invalid_curl_cookies';
        userFriendlyMessage = 'The cURL command is missing required LinkedIn session cookies (li_at or JSESSIONID)';
        validationErrors = [
          'Missing required LinkedIn cookies (li_at or JSESSIONID)',
          'Please copy cURL from an active LinkedIn session',
          'Ensure you are logged into LinkedIn in your browser',
          'Copy from a request to /voyager/api/messaging/conversations'
        ];
      } else if (backendErrorMessage.includes('Rate limit') || 
                 backendErrorMessage.includes('too many requests') ||
                 backendErrorMessage.includes('rate limited')) {
        // Rate limiting error
        detectedErrorType = 'rate_limited';
        userFriendlyMessage = 'LinkedIn is rate limiting requests';
        validationErrors = [
          'LinkedIn is rate limiting requests',
          'Please wait 5 minutes before trying again',
          'Use a private/incognito browser window',
          'This is temporary and will resolve automatically'
        ];
      } else if (backendErrorMessage.includes('CSRF') || 
                 backendErrorMessage.includes('csrf') ||
                 backendErrorMessage.includes('csrf-token')) {
        // CSRF token error
        detectedErrorType = 'malformed_curl';
        userFriendlyMessage = 'The cURL command is missing a valid CSRF token';
        validationErrors = [
          'Missing or invalid CSRF token',
          'Refresh your LinkedIn page',
          'Find a fresh API request in the Network tab',
          'Copy a new cURL command that includes csrf-token header'
        ];
      } else if (backendErrorMessage.includes('expired') || 
                 backendErrorMessage.includes('session expired') ||
                 backendErrorMessage.includes('invalid session')) {
        // Session expired error
        detectedErrorType = 'session_expired';
        userFriendlyMessage = 'Your LinkedIn session has expired';
        validationErrors = [
          'Your LinkedIn session has expired',
          'Please log out and log back into LinkedIn',
          'Get a fresh cURL command from the Network tab',
          'Ensure you are copying from an active session'
        ];
      } else if (backendErrorMessage.includes('authentication') ||
                 backendErrorMessage.includes('unauthorized') ||
                 backendErrorMessage.includes('login') ||
                 backendErrorMessage.includes('auth')) {
        // General authentication error
        detectedErrorType = 'auth_failed';
        userFriendlyMessage = 'Authentication failed with your LinkedIn account';
        validationErrors = [
          'Authentication failed with your LinkedIn account',
          'Ensure you are logged into the correct LinkedIn account',
          'Try logging out and back into LinkedIn',
          'Copy a fresh cURL command from an active session'
        ];
      } else if (backendErrorMessage.includes('network') ||
                 backendErrorMessage.includes('connection') ||
                 backendErrorMessage.includes('timeout')) {
        // Network error
        detectedErrorType = 'network_error';
        userFriendlyMessage = 'Network error occurred during authentication';
        validationErrors = [
          'Network error occurred during authentication',
          'Check your internet connection',
          'This is usually temporary - try again',
          'Ensure the LinkedIn API endpoint is accessible'
        ];
      } else if (backendErrorMessage.includes('malformed') ||
                 backendErrorMessage.includes('invalid curl') ||
                 backendErrorMessage.includes('parse error') ||
                 backendErrorMessage.includes('invalid format')) {
        // Malformed cURL error
        detectedErrorType = 'malformed_curl';
        userFriendlyMessage = 'The cURL command is incomplete or malformed';
        validationErrors = [
          'The cURL command is incomplete or malformed',
          'Ensure you copy the COMPLETE command with all headers',
          'Look for requests to /voyager/api/messaging/conversations',
          'Use "Copy as cURL (bash)" not "Copy as cURL (cmd)"'
        ];
      } else {
        // Unknown/generic error - still provide helpful guidance
        detectedErrorType = 'auth_failed';
        userFriendlyMessage = `Connection failed: ${backendErrorMessage}`;
        validationErrors = [
          'An unexpected error occurred during authentication',
          'Please try with a fresh cURL command',
          'Ensure you copied from an active LinkedIn session',
          'Check that the cURL contains proper LinkedIn cookies'
        ];
      }
      
      // Apply intelligent error handling using the existing system
      setErrorMessage(userFriendlyMessage);
      setErrorType(detectedErrorType);
      setCurlValidationErrors(validationErrors);
      setShowDetailedHelp(true);
      setCurrentPhase('curl_input'); // Stay in cURL input phase for better UX
      setConnectionStatus('failed');
      
      // Set retry countdown for rate limiting
      if (detectedErrorType === 'rate_limited') {
        setRetryCountdown(300); // 5 minutes
        startRetryCountdown();
      }
      
      // Show appropriate toast message
      switch (detectedErrorType) {
        case 'invalid_curl_cookies':
          toast.error('Invalid cURL: Missing LinkedIn cookies. Please follow the guide below.');
          break;
        case 'session_expired':
          toast.error('LinkedIn session expired. Please refresh and try again.');
          break;
        case 'malformed_curl':
          toast.error('Invalid cURL format. Please check the requirements below.');
          break;
        case 'rate_limited':
          toast.error('Rate limited. Please wait before retrying.');
          break;
        case 'auth_failed':
          toast.error('Authentication failed. Please check your LinkedIn session.');
          break;
        case 'network_error':
          toast.error('Network error. Please check your connection and retry.');
          break;
        default:
          toast.error('Connection failed. Please try again.');
          break;
      }
      
    } finally {
      setIsLoading(false);
    }
  }, [curlCommand, bridgeRoomId, dispatch, startRetryCountdown]);

  // ENHANCED: Submit cookie header with intelligent error handling
  const submitCookieHeader = useCallback(async () => {
    if (!cookieHeader.trim()) {
      setErrorMessage('Please enter a valid Cookie header');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage('');
      setErrorType(null);
      setErrorGuidance('');
      setShowDetailedHelp(false);
      setCurlValidationErrors([]);
      setConnectionAttempts(prev => prev + 1);
      setLastAttemptTime(new Date());
      
      logger.info('[LinkedInBridgeSetup] Submitting Cookie header');
      
      const response = await createLinkedInApiCall('/api/v1/matrix/linkedin/connect', {
        cookieHeader: cookieHeader.trim(),
        bridgeRoomId
      });
      
      if (response.data?.success) {
        // Check if already connected from cookie submission
        if (response.data?.connected) {
          setCurrentPhase('success');
          setConnectionStatus('connected');
          dispatch(setLinkedInConnected(true));
          dispatch(setLinkedInSetupState('completed'));
          saveLinkedInStatus(true);
          toast.success('LinkedIn connected successfully!');
          logger.info('[LinkedInBridgeSetup] LinkedIn connection successful from cookie submission');
        } else {
          // Set connecting state, Socket.IO will handle the rest
          setCurrentPhase('connecting');
          setConnectionStatus('connecting');
          dispatch(setLinkedInSetupState('connecting'));
          
          // Set connection timeout as fallback
          connectionTimeout.current = setTimeout(() => {
            setErrorMessage('Connection timeout. Please try again.');
            setCurrentPhase('error');
            setConnectionStatus('failed');
          }, 60000); // 1 minute timeout
        }
      } else {
        throw new Error(response.data?.message || 'Failed to process Cookie header');
      }
    } catch (error) {
      logger.error('[LinkedInBridgeSetup] Error submitting Cookie header:', error);
      
      // ENHANCED: Intelligent backend error detection and handling for cookies
      const backendErrorMessage = error.response?.data?.message || error.message || 'Failed to process Cookie header';
      
      // Analyze backend error message and map to appropriate error types
      let detectedErrorType = null;
      let userFriendlyMessage = '';
      let validationErrors = [];
      
      if (backendErrorMessage.includes('Missing li_at or JSESSIONID') ||
          backendErrorMessage.includes('li_at') || 
          backendErrorMessage.includes('JSESSIONID') ||
          backendErrorMessage.includes('missing required cookies') ||
          backendErrorMessage.includes('authentication cookies not found')) {
        // Specific LinkedIn cookie missing error for cookie method
        detectedErrorType = 'invalid_cookie_missing';
        userFriendlyMessage = 'The Cookie header is missing required LinkedIn session cookies (li_at or JSESSIONID)';
        validationErrors = [
          'Missing required LinkedIn cookies (li_at or JSESSIONID)',
          'Please copy complete Cookie header from an active LinkedIn session',
          'Ensure you are logged into LinkedIn in your browser',
          'Copy from a request to linkedin.com domain'
        ];
      } else if (backendErrorMessage.includes('Rate limit') || 
                 backendErrorMessage.includes('too many requests') ||
                 backendErrorMessage.includes('rate limited')) {
        // Rate limiting error for cookie method
        detectedErrorType = 'rate_limited';
        userFriendlyMessage = 'LinkedIn is rate limiting requests';
        validationErrors = [
          'LinkedIn is rate limiting requests',
          'Please wait 5 minutes before trying again',
          'Use a private/incognito browser window',
          'This is temporary and will resolve automatically'
        ];
      } else if (backendErrorMessage.includes('expired') || 
                 backendErrorMessage.includes('session expired') ||
                 backendErrorMessage.includes('invalid session')) {
        // Session expired error for cookie method
        detectedErrorType = 'session_expired';
        userFriendlyMessage = 'Your LinkedIn session has expired';
        validationErrors = [
          'Your LinkedIn session has expired',
          'Please log out and log back into LinkedIn',
          'Get a fresh Cookie header from the Network tab',
          'Ensure you are copying from an active session'
        ];
      } else if (backendErrorMessage.includes('malformed') ||
                 backendErrorMessage.includes('invalid cookie') ||
                 backendErrorMessage.includes('parse error') ||
                 backendErrorMessage.includes('invalid format')) {
        // Malformed cookie error
        detectedErrorType = 'malformed_cookie';
        userFriendlyMessage = 'The Cookie header is incomplete or malformed';
        validationErrors = [
          'The Cookie header is incomplete or malformed',
          'Ensure you copy the COMPLETE Cookie header value',
          'Include all cookie values (li_at, JSESSIONID, etc.)',
          'Do not include the "Cookie: " prefix, just the values'
        ];
      } else {
        // Unknown/generic error for cookie method
        detectedErrorType = 'auth_failed';
        userFriendlyMessage = `Connection failed: ${backendErrorMessage}`;
        validationErrors = [
          'An unexpected error occurred during authentication',
          'Please try with a fresh Cookie header',
          'Ensure you copied from an active LinkedIn session',
          'Check that the Cookie contains proper LinkedIn cookies'
        ];
      }
      
      // Apply intelligent error handling using the existing system
      setErrorMessage(userFriendlyMessage);
      setErrorType(detectedErrorType);
      setCurlValidationErrors(validationErrors);
      setShowDetailedHelp(true);
      setCurrentPhase('cookie_input'); // Stay in cookie input phase for better UX
      setConnectionStatus('failed');
      
      // Set retry countdown for rate limiting
      if (detectedErrorType === 'rate_limited') {
        setRetryCountdown(300); // 5 minutes
        startRetryCountdown();
      }
      
      // Show appropriate toast message
      switch (detectedErrorType) {
        case 'invalid_cookie_missing':
          toast.error('Invalid Cookie: Missing LinkedIn cookies. Please follow the guide below.');
          break;
        case 'session_expired':
          toast.error('LinkedIn session expired. Please refresh and try again.');
          break;
        case 'malformed_cookie':
          toast.error('Invalid Cookie format. Please check the requirements below.');
          break;
        case 'rate_limited':
          toast.error('Rate limited. Please wait before retrying.');
          break;
        case 'auth_failed':
          toast.error('Authentication failed. Please check your LinkedIn session.');
          break;
        default:
          toast.error('Connection failed. Please try again.');
          break;
      }
      
    } finally {
      setIsLoading(false);
    }
  }, [cookieHeader, bridgeRoomId, dispatch, startRetryCountdown]);

  // ENHANCED: Clear error state and allow retry
  const clearErrorAndRetry = useCallback(() => {
    setErrorMessage('');
    setErrorType(null);
    setErrorGuidance('');
    setShowDetailedHelp(false);
    setCurlValidationErrors([]);
    setConnectionStatus('disconnected');
    // Stay in curl_input phase - don't reset to instructions
    // This allows user to fix their cURL and try again seamlessly
  }, []);

  // Handle full retry (back to instructions)
  const handleFullRetry = useCallback(() => {
    setCurrentPhase('instructions');
    setErrorMessage('');
    setErrorType(null);
    setErrorGuidance('');
    setShowDetailedHelp(false);
    setCurlValidationErrors([]);
    setCurlCommand('');
    setConnectionStatus('disconnected');
    setConnectionAttempts(0);
    setLastAttemptTime(null);
    setInstructions('');
    setRetryCountdown(0);
    
    clearAllTimers();
    
    dispatch(resetLinkedInSetup());
  }, [dispatch, clearAllTimers]);

  // Handle completion
  const handleComplete = useCallback(() => {
    if (onComplete) {
      onComplete();
    }
  }, [onComplete]);

  // Copy cURL template
  const copyCurlTemplate = useCallback(() => {
    const template = `curl 'https://www.linkedin.com/voyager/api/messaging/conversations' \\
  -H 'accept: application/vnd.linkedin.normalized+json+2.1' \\
  -H 'accept-language: en-US,en;q=0.9' \\
  -H 'cookie: YOUR_COOKIES_HERE' \\
  -H 'csrf-token: YOUR_CSRF_TOKEN_HERE' \\
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'`;
    
    navigator.clipboard.writeText(template);
    toast.success('cURL template copied to clipboard');
  }, []);

  // Render phase content
  const renderPhaseContent = () => {
    switch (currentPhase) {
      case 'instructions':
        return (
          <div className="space-y-6">
            {/* ENHANCED: Prominent Private/Incognito Window Alert */}
            <Alert className="border-purple-200 bg-purple-50 dark:bg-purple-950 border-2">
              <Shield className="h-5 w-5 text-purple-600" />
              <AlertDescription>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <EyeOff className="h-4 w-4 text-purple-600" />
                    <strong className="text-purple-800 dark:text-purple-200 text-base">CRITICAL: Use Private/Incognito Window ONLY</strong>
                  </div>
                  <div className="text-purple-700 dark:text-purple-300 text-sm space-y-1">
                    <p>• <strong>Chrome:</strong> Press Ctrl+Shift+N (Incognito Mode)</p>
                    <p>• <strong>Firefox:</strong> Press Ctrl+Shift+P (Private Window)</p>
                    <p>• <strong>Edge:</strong> Press Ctrl+Shift+N (InPrivate Window)</p>
                    <p className="text-xs mt-2 text-purple-600 dark:text-purple-400">
                      <strong>Why?</strong> Prevents session conflicts, ensures clean cookies, and improves connection success rate by 90%+
                    </p>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              <AlertDescription className="text-orange-800 dark:text-orange-200">
                <strong>Developer Method:</strong> This connection requires technical knowledge of browser developer tools and network inspection.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Terminal className="h-5 w-5 text-blue-500" />
                Step-by-Step Instructions
              </h3>
              
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3 p-3 bg-purple-50 dark:bg-purple-950 rounded-lg border border-purple-200">
                  <Badge variant="outline" className="mt-0.5 text-xs bg-purple-100 text-purple-800 border-purple-300">1</Badge>
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      <EyeOff className="h-4 w-4 text-purple-600" />
                      Open LinkedIn in Private/Incognito Window
                    </p>
                    <p className="text-muted-foreground mt-1">
                      <strong className="text-purple-700">IMPORTANT:</strong> Press Ctrl+Shift+N (Chrome) or Ctrl+Shift+P (Firefox) for a clean session
                    </p>
                    <p className="text-xs text-purple-600 mt-1">Navigate to linkedin.com and log in to your account</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                  <Badge variant="outline" className="mt-0.5 text-xs">2</Badge>
                  <div>
                    <p className="font-medium">Open Developer Tools</p>
                    <p className="text-muted-foreground mt-1">Press F12 or right-click → Inspect Element, then go to Network tab</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                  <Badge variant="outline" className="mt-0.5 text-xs">3</Badge>
                  <div>
                    <p className="font-medium">Navigate to Messages</p>
                    <p className="text-muted-foreground mt-1">Go to LinkedIn Messages to trigger network requests</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                  <Badge variant="outline" className="mt-0.5 text-xs">4</Badge>
                  <div>
                    <p className="font-medium">Find the API Request</p>
                    <p className="text-muted-foreground mt-1">Look for a request to <code>/voyager/api/messaging/conversations</code> in the Network tab</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                  <Badge variant="outline" className="mt-0.5 text-xs">5</Badge>
                  <div>
                    <p className="font-medium">Copy as cURL</p>
                    <p className="text-muted-foreground mt-1">Right-click the request → Copy → Copy as cURL (bash)</p>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={copyCurlTemplate}
                  variant="outline" 
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Copy className="h-4 w-4" />
                  Copy Template
                </Button>
                <Button 
                  onClick={() => window.open('https://developer.chrome.com/docs/devtools/network/', '_blank')}
                  variant="outline" 
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  DevTools Guide
                </Button>
              </div>
            </div>
            
            <div className="flex gap-3">
              <Button onClick={() => setCurrentPhase('method_selection')} disabled={isLoading} className="flex-1">
                Choose Connection Method
              </Button>
              <Button onClick={onCancel} variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        );

      case 'method_selection':
        return (
          <div className="space-y-4">
            {/* ENHANCED: Prominent Private/Incognito Window Reminder */}
            <Alert className="border-purple-200 bg-purple-50 dark:bg-purple-950 border-2">
              <EyeOff className="h-4 w-4 text-purple-600" />
              <AlertDescription>
                <div className="text-center">
                  <strong className="text-purple-800 dark:text-purple-200">🔒 REMINDER: Use Private/Incognito Window</strong>
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                    Ensure you're logged into LinkedIn in a private/incognito browser window for best results
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            <div className="text-center">
              <Linkedin className="h-10 w-10 text-blue-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold">Choose LinkedIn Connection Method</h3>
              <p className="text-muted-foreground mt-1 text-sm">Select your preferred method to connect your LinkedIn account</p>
            </div>

            <div className="space-y-3">
              {/* Cookie Method - Recommended */}
              <div className="relative">
                <Button
                  onClick={() => initializeConnection('cookie')}
                  disabled={isLoading}
                  variant="outline"
                  className="w-full p-3 h-auto text-left border-2 hover:border-blue-500 focus:border-blue-500 transition-all duration-200 group"
                >
                  <div className="flex items-start justify-between w-full p-2">
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Cookie className="text-blue-500 h-4 w-4 flex-shrink-0" />
                        <h4 className="font-semibold text-gray-900 text-sm">Cookie Header Method</h4>
                        <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs px-1.5 py-0.5 flex-shrink-0">Recommended</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1.5 leading-relaxed">
                        Copy the Cookie header from your <strong className="text-purple-600">private/incognito</strong> browser's Network tab. <span className="block">Simpler and more reliable.</span>
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Check className="h-3 w-3 text-green-500" />
                          <span>Easier to copy</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Check className="h-3 w-3 text-green-500" />
                          <span>More reliable</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Check className="h-3 w-3 text-green-500" />
                          <span>Less errors</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="text-muted-foreground group-hover:text-blue-500 transition-colors h-4 w-4 flex-shrink-0 mt-1" />
                  </div>
                </Button>
              </div>

              {/* cURL Method */}
              <div className="relative">
                <Button
                  onClick={() => initializeConnection('curl')}
                  disabled={isLoading}
                  variant="outline"
                  className="w-full p-3 h-auto text-left border-2 hover:border-blue-500 focus:border-blue-500 transition-all duration-200 group"
                >
                  <div className="flex items-start justify-between w-full p-2">
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Terminal className="text-blue-500 h-4 w-4 flex-shrink-0" />
                        <h4 className="font-semibold text-gray-900 text-sm">cURL Command Method</h4>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1.5 leading-relaxed">
                        Copy the complete cURL command from your <strong className="text-purple-600">private/incognito</strong> browser's Network tab. <span className="block">For advanced users.</span>
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Dot className="h-3 w-3" />
                          <span>Full HTTP details</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Dot className="h-3 w-3" />
                          <span>Advanced debugging</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Dot className="h-3 w-3" />
                          <span>More complex</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="text-muted-foreground group-hover:text-blue-500 transition-colors h-4 w-4 flex-shrink-0 mt-1" />
                  </div>
                </Button>
              </div>
            </div>

            {/* Compact Instructions */}
            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription>
                <div className="space-y-1">
                  <strong className="text-blue-800 dark:text-blue-200 text-sm">What you'll need:</strong>
                  <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                    <div className="flex items-center gap-2">
                      <EyeOff className="h-3 w-3 text-purple-600" />
                      <span><strong>Private/Incognito</strong> LinkedIn session in browser</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-3 w-3" />
                      <span>Browser Developer Tools access (F12)</span>
                    </div>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            {/* Back Button */}
            <div className="flex gap-3">
              <Button onClick={() => setCurrentPhase('instructions')} variant="outline" className="flex-1 text-sm">
                ← Back to Instructions
              </Button>
            </div>
          </div>
        );

      case 'curl_input':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Code className="h-12 w-12 text-blue-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold">Paste Your cURL Command</h3>
              <p className="text-muted-foreground mt-2">
                {instructions || "Paste the cURL command you copied from your browser's Network tab"}
              </p>
            </div>

            {/* ENHANCED: Show validation errors and guidance */}
            {curlValidationErrors.length > 0 && (
              <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription>
                  <div className="space-y-2">
                    <strong className="text-orange-800 dark:text-orange-200">
                      {errorType === 'invalid_curl_cookies' && 'Missing LinkedIn Cookies'}
                      {errorType === 'session_expired' && 'Session Expired'}
                      {errorType === 'malformed_curl' && 'Invalid cURL Format'}
                      {errorType === 'rate_limited' && 'Rate Limited'}
                      {(errorType === 'auth_failed' || errorType === 'login_failed' || errorType === 'invalid_cookies') && 'Authentication Failed'}
                      {errorType === 'network_error' && 'Network Error'}
                      {!errorType && 'Connection Issue'}
                    </strong>
                    <ul className="list-disc list-inside space-y-1 text-orange-700 dark:text-orange-300">
                      {curlValidationErrors.map((error, index) => (
                        <li key={index} className="text-sm">{error}</li>
                      ))}
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* ENHANCED: Rate limit countdown */}
            {retryCountdown > 0 && (
              <Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950">
                <Clock className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                  <div className="flex items-center justify-between">
                    <span>Please wait before retrying:</span>
                    <Badge variant="outline" className="text-yellow-800 border-yellow-300">
                      {Math.floor(retryCountdown / 60)}:{(retryCountdown % 60).toString().padStart(2, '0')}
                    </Badge>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <label className="text-sm font-medium">cURL Command:</label>
              <Textarea
                value={curlCommand}
                onChange={(e) => setCurlCommand(e.target.value)}
                placeholder="curl 'https://www.linkedin.com/voyager/api/messaging/conversations' -H 'accept: application/vnd.linkedin.normalized+json+2.1' ..."
                className={`min-h-[120px] font-mono text-sm ${
                  curlValidationErrors.length > 0 ? 'border-orange-300 focus:border-orange-500' : ''
                }`}
                disabled={isLoading || retryCountdown > 0}
              />
              {curlCommand && (
                <p className="text-xs text-muted-foreground">
                  ✓ cURL command detected ({curlCommand.length} characters)
                </p>
              )}
            </div>

            {/* ENHANCED: Detailed help section */}
            {showDetailedHelp && (
              <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950">
                <Info className="h-4 w-4 text-blue-600" />
                <AlertDescription>
                  <div className="space-y-3">
                    <strong className="text-blue-800 dark:text-blue-200">How to get the correct cURL command:</strong>
                    <ol className="list-decimal list-inside space-y-2 text-sm text-blue-700 dark:text-blue-300">
                      <li className="flex items-start gap-2">
                        <span className="text-purple-600 font-bold">🔒</span>
                        <span>Open LinkedIn in a <strong className="text-purple-700 bg-purple-100 px-1 rounded">private/incognito browser window</strong> (Ctrl+Shift+N)</span>
                      </li>
                      <li>Log in to your LinkedIn account <em>(in the private window)</em></li>
                      <li>Open Developer Tools (Press F12)</li>
                      <li>Go to the <strong>Network</strong> tab</li>
                      <li>Navigate to <strong>LinkedIn Messages</strong></li>
                      <li>Look for a request to <code>/voyager/api/messaging/conversations</code></li>
                      <li>Right-click the request → Copy → <strong>Copy as cURL (bash)</strong></li>
                      <li>Paste the complete command below</li>
                    </ol>
                    
                    {errorType === 'invalid_curl_cookies' && (
                      <div className="mt-3 p-3 bg-blue-100 dark:bg-blue-900 rounded">
                        <strong>Missing Cookies Fix:</strong>
                        <p className="text-sm mt-1">The cURL command must include LinkedIn cookies (li_at and JSESSIONID). 
                        Make sure you're logged into LinkedIn <strong className="text-purple-700">in a private/incognito window</strong> when copying the cURL.</p>
                      </div>
                    )}
                    
                    {errorType === 'session_expired' && (
                      <div className="mt-3 p-3 bg-blue-100 dark:bg-blue-900 rounded">
                        <strong>Session Expired Fix:</strong>
                        <p className="text-sm mt-1">Your LinkedIn session has expired. Please open a <strong className="text-purple-700">fresh private/incognito window</strong>, 
                        log back in, and get a fresh cURL command.</p>
                      </div>
                    )}
                    
                    {errorType === 'malformed_curl' && (
                      <div className="mt-3 p-3 bg-blue-100 dark:bg-blue-900 rounded">
                        <strong>Format Requirements:</strong>
                        <ul className="text-sm mt-1 list-disc list-inside">
                          <li>Must start with "curl"</li>
                          <li>Include multiple -H headers</li>
                          <li>Must be complete (don't truncate)</li>
                          <li>Use "Copy as cURL (bash)" not cmd</li>
                          <li><strong className="text-purple-700">Copy from private/incognito window</strong></li>
                        </ul>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* ENHANCED: Error message display */}
            {errorMessage && !showDetailedHelp && (
              <Alert className="border-red-200 bg-red-50 dark:bg-red-950">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800 dark:text-red-200">
                  {errorMessage}
                </AlertDescription>
              </Alert>
            )}

            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950">
              <AlertTriangle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800 dark:text-blue-200">
                <strong>Security Note:</strong> This cURL command contains your session cookies. 
                Never share this with untrusted parties.
              </AlertDescription>
            </Alert>

            <div className="flex gap-3">
              {/* ENHANCED: Smart button states */}
              <Button 
                onClick={submitCurlCommand} 
                disabled={!curlCommand.trim() || isLoading || retryCountdown > 0}
                className="flex-1"
              >
                {isLoading ? 'Connecting...' : 
                 retryCountdown > 0 ? `Wait ${Math.floor(retryCountdown / 60)}:${(retryCountdown % 60).toString().padStart(2, '0')}` : 
                 connectionAttempts > 0 ? 'Try Again' : 'Connect LinkedIn'}
              </Button>
              
              {/* ENHANCED: Smart retry options */}
              {curlValidationErrors.length > 0 && !isLoading && retryCountdown === 0 && (
                <Button 
                  onClick={clearErrorAndRetry} 
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Clear Error
                </Button>
              )}
              
              <Button onClick={() => setCurrentPhase('instructions')} variant="outline">
                Back
              </Button>
            </div>

            {/* ENHANCED: Show detailed help toggle */}
            {!showDetailedHelp && connectionAttempts > 0 && (
              <div className="text-center">
                <Button 
                  onClick={() => setShowDetailedHelp(true)} 
                  variant="ghost" 
                  size="sm"
                  className="text-blue-600 hover:text-blue-800"
                >
                  <Info className="h-4 w-4 mr-2" />
                  Show detailed cURL guide
                </Button>
              </div>
            )}
          </div>
        );

      case 'cookie_input':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Cookie className="h-12 w-12 text-blue-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold">Paste Your Cookie Header</h3>
              <p className="text-muted-foreground mt-2">
                {instructions || "Paste the Cookie header you copied from your browser's Network tab"}
              </p>
            </div>

            {/* ENHANCED: Show validation errors and guidance */}
            {curlValidationErrors.length > 0 && (
              <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription>
                  <div className="space-y-2">
                    <strong className="text-orange-800 dark:text-orange-200">
                      {errorType === 'invalid_cookie_missing' && 'Missing LinkedIn Cookies'}
                      {errorType === 'session_expired' && 'Session Expired'}
                      {errorType === 'malformed_cookie' && 'Invalid Cookie Format'}
                      {errorType === 'rate_limited' && 'Rate Limited'}
                      {(errorType === 'auth_failed' || errorType === 'login_failed' || errorType === 'invalid_cookies') && 'Authentication Failed'}
                      {errorType === 'network_error' && 'Network Error'}
                      {!errorType && 'Connection Issue'}
                    </strong>
                    <ul className="list-disc list-inside space-y-1 text-orange-700 dark:text-orange-300">
                      {curlValidationErrors.map((error, index) => (
                        <li key={index} className="text-sm">{error}</li>
                      ))}
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* ENHANCED: Rate limit countdown */}
            {retryCountdown > 0 && (
              <Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950">
                <Clock className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                  <div className="flex items-center justify-between">
                    <span>Please wait before retrying:</span>
                    <Badge variant="outline" className="text-yellow-800 border-yellow-300">
                      {Math.floor(retryCountdown / 60)}:{(retryCountdown % 60).toString().padStart(2, '0')}
                    </Badge>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <label className="text-sm font-medium">Cookie Header:</label>
              <Textarea
                value={cookieHeader}
                onChange={(e) => setCookieHeader(e.target.value)}
                placeholder="li_at=AQEDATjhVXgBT...; JSESSIONID=ajax:123...; bcookie=v=2&456..."
                className={`min-h-[120px] font-mono text-sm ${
                  curlValidationErrors.length > 0 ? 'border-orange-300 focus:border-orange-500' : ''
                }`}
                disabled={isLoading || retryCountdown > 0}
              />
              {cookieHeader && (
                <p className="text-xs text-muted-foreground">
                  ✓ Cookie header detected ({cookieHeader.length} characters)
                </p>
              )}
            </div>

            {/* ENHANCED: Detailed help section */}
            {showDetailedHelp && (
              <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950">
                <Info className="h-4 w-4 text-blue-600" />
                <AlertDescription>
                  <div className="space-y-3">
                    <strong className="text-blue-800 dark:text-blue-200">How to get the correct Cookie header:</strong>
                    <ol className="list-decimal list-inside space-y-2 text-sm text-blue-700 dark:text-blue-300">
                      <li className="flex items-start gap-2">
                        <span className="text-purple-600 font-bold">🔒</span>
                        <span>Open LinkedIn in a <strong className="text-purple-700 bg-purple-100 px-1 rounded">private/incognito browser window</strong> (Ctrl+Shift+N)</span>
                      </li>
                      <li>Log in to your LinkedIn account <em>(in the private window)</em></li>
                      <li>Open Developer Tools (Press F12)</li>
                      <li>Go to the <strong>Network</strong> tab</li>
                      <li>Navigate to <strong>LinkedIn Messages</strong></li>
                      <li>Look for a request to <code>linkedin.com</code></li>
                      <li>Click on the request and go to <strong>Headers</strong> tab</li>
                      <li>Find the <strong>Cookie</strong> header and copy its value</li>
                      <li>Paste the complete cookie value below</li>
                    </ol>
                    
                    {errorType === 'invalid_cookie_missing' && (
                      <div className="mt-3 p-3 bg-blue-100 dark:bg-blue-900 rounded">
                        <strong>Missing Cookies Fix:</strong>
                        <p className="text-sm mt-1">The Cookie header must include LinkedIn cookies (li_at and JSESSIONID). 
                        Make sure you're logged into LinkedIn <strong className="text-purple-700">in a private/incognito window</strong> when copying the Cookie header.</p>
                      </div>
                    )}
                    
                    {errorType === 'session_expired' && (
                      <div className="mt-3 p-3 bg-blue-100 dark:bg-blue-900 rounded">
                        <strong>Session Expired Fix:</strong>
                        <p className="text-sm mt-1">Your LinkedIn session has expired. Please open a <strong className="text-purple-700">fresh private/incognito window</strong>, 
                        log back in, and get a fresh Cookie header.</p>
                      </div>
                    )}
                    
                    {errorType === 'malformed_cookie' && (
                      <div className="mt-3 p-3 bg-blue-100 dark:bg-blue-900 rounded">
                        <strong>Format Requirements:</strong>
                        <ul className="text-sm mt-1 list-disc list-inside">
                          <li>Include complete cookie values (li_at, JSESSIONID, etc.)</li>
                          <li>Don't include the "Cookie: " prefix</li>
                          <li>Copy from a request to linkedin.com domain</li>
                          <li>Should look like: "li_at=ABC...; JSESSIONID=DEF..."</li>
                          <li><strong className="text-purple-700">Copy from private/incognito window</strong></li>
                        </ul>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* ENHANCED: Error message display */}
            {errorMessage && !showDetailedHelp && (
              <Alert className="border-red-200 bg-red-50 dark:bg-red-950">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800 dark:text-red-200">
                  {errorMessage}
                </AlertDescription>
              </Alert>
            )}

            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950">
              <AlertTriangle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800 dark:text-blue-200">
                <strong>Security Note:</strong> This Cookie header contains your session information. 
                Never share this with untrusted parties.
              </AlertDescription>
            </Alert>

            <div className="flex gap-3">
              {/* ENHANCED: Smart button states */}
              <Button 
                onClick={submitCookieHeader} 
                disabled={!cookieHeader.trim() || isLoading || retryCountdown > 0}
                className="flex-1"
              >
                {isLoading ? 'Connecting...' : 
                 retryCountdown > 0 ? `Wait ${Math.floor(retryCountdown / 60)}:${(retryCountdown % 60).toString().padStart(2, '0')}` : 
                 connectionAttempts > 0 ? 'Try Again' : 'Connect LinkedIn'}
              </Button>
              
              {/* ENHANCED: Smart retry options */}
              {curlValidationErrors.length > 0 && !isLoading && retryCountdown === 0 && (
                <Button 
                  onClick={clearErrorAndRetry} 
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Clear Error
                </Button>
              )}
              
              <Button onClick={() => setCurrentPhase('method_selection')} variant="outline">
                Back
              </Button>
            </div>

            {/* ENHANCED: Show detailed help toggle */}
            {!showDetailedHelp && connectionAttempts > 0 && (
              <div className="text-center">
                <Button 
                  onClick={() => setShowDetailedHelp(true)} 
                  variant="ghost" 
                  size="sm"
                  className="text-blue-600 hover:text-blue-800"
                >
                  <Info className="h-4 w-4 mr-2" />
                  Show detailed Cookie guide
                </Button>
              </div>
            )}
          </div>
        );

      case 'connecting':
        return (
          <div className="space-y-6 text-center">
            <div className="space-y-4">
              <Clock className="h-12 w-12 text-blue-500 mx-auto animate-pulse" />
              <h3 className="text-lg font-semibold">Connecting to LinkedIn...</h3>
              <p className="text-muted-foreground">
                Please wait while we establish the connection. This may take up to 60 seconds.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
              <p className="text-xs text-muted-foreground">
                Attempt {connectionAttempts} • Started {lastAttemptTime?.toLocaleTimeString()}
              </p>
            </div>

            <Button onClick={handleFullRetry} variant="outline" size="sm">
              Cancel Connection
            </Button>
          </div>
        );

      case 'success':
        return (
          <div className="space-y-6 text-center">
            <div className="space-y-4">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
              <h3 className="text-lg font-semibold text-green-600">LinkedIn Connected Successfully!</h3>
              <p className="text-muted-foreground">
                Your LinkedIn account has been connected and is ready to use.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 text-sm">
              <Wifi className="h-4 w-4 text-green-500" />
              <span className="text-green-600 font-medium">Connected</span>
            </div>

            <Button onClick={handleComplete} className="w-full">
              Continue to Dashboard
            </Button>
          </div>
        );

      case 'error':
        return (
          <div className="space-y-6 text-center">
            <div className="space-y-4">
              <WifiOff className="h-12 w-12 text-red-500 mx-auto" />
              <h3 className="text-lg font-semibold text-red-600">Connection Failed</h3>
              {errorMessage && (
                <Alert className="border-red-200 bg-red-50 dark:bg-red-950 text-left">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800 dark:text-red-200">
                    <div className="whitespace-pre-line text-sm leading-relaxed">
                      {errorMessage}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div className="flex gap-3">
              <Button onClick={handleFullRetry} className="flex-1">
                Try Again
              </Button>
              <Button onClick={onCancel} variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader className="text-center border-b">
        <CardTitle className="flex items-center justify-center gap-2">
          <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold">L</span>
          </div>
          LinkedIn Bridge Setup
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-6">
        {renderPhaseContent()}
      </CardContent>
    </Card>
  );
};

LinkedInBridgeSetup.propTypes = {
  onComplete: PropTypes.func,
  onCancel: PropTypes.func
};

export default LinkedInBridgeSetup;