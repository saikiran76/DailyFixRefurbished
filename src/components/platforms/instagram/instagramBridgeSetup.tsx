import { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import logger from '@/utils/logger';
import { toast } from 'react-hot-toast';
import { saveInstagramStatus } from '@/utils/connectionStorage';
import { shouldAllowCompleteTransition } from '@/utils/onboardingFix';
import PropTypes from 'prop-types';
import api from '@/utils/api';
import {
  setInstagramSetupState,
  setInstagramError,
  resetInstagramSetup,
  setInstagramBridgeRoomId,
  selectInstagramSetup,
  setInstagramConnected
} from '@/store/slices/onboardingSlice';
import { getSupabaseClient } from '@/utils/supabase';
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
  Shield,
  Eye,
  EyeOff,
  Info
} from 'lucide-react';
import { useSocketConnection } from '@/hooks/useSocketConnection';

// Instagram-specific API base URL for testing
const INSTAGRAM_API_BASE = 'https://dailyfix-api-gateway.duckdns.org';

// Create Instagram-specific API instance using the shared api utility
const createInstagramApiCall = (endpoint, data = null, method = 'POST') => {
  // Store the original baseURL
  const originalBaseURL = api.defaults.baseURL;
  
  // Temporarily override the baseURL for this request
  api.defaults.baseURL = INSTAGRAM_API_BASE;
  
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
export function resetInstagramSetupFlags(forceReset = false) {
  // Only reset if force flag is passed
  if (forceReset) {
    // Clear any session storage keys related to Instagram
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith('instagram_initializing_') || key.startsWith('Instagram_initializing_')) {
        sessionStorage.removeItem(key);
      }
    });
    
    // Clear any localStorage keys related to Instagram setup
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('instagram_setup_') || key.startsWith('Instagram_setup_')) {
        localStorage.removeItem(key);
      }
    });
    
    logger.info('[InstagramBridgeSetup] All initialization flags reset');
  }
}

// Instagram Bridge Setup Component
const InstagramBridgeSetup = ({ onComplete, onCancel }) => {
  const dispatch = useDispatch();
  const instagramSetup = useSelector(selectInstagramSetup);
  const { socket, isConnected, on } = useSocketConnection('matrix');
  
  const [currentPhase, setCurrentPhase] = useState('instructions'); // instructions, waiting, curl_input, connecting, success, error
  const [curlCommand, setCurlCommand] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [bridgeRoomId, setBridgeRoomId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [lastAttemptTime, setLastAttemptTime] = useState(null);
  const [instructions, setInstructions] = useState('');
  
  // Refs for managing intervals and timeouts
  const statusCheckInterval = useRef(null);
  const connectionTimeout = useRef(null);
  
  // ADD: Socket.IO event listeners for real-time updates
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Listen for cURL prompt from backend
    const handleCurlPrompt = (data) => {
      logger.info('[InstagramBridgeSetup] Received cURL prompt via Socket.IO:', data);
      setBridgeRoomId(data.roomId);
      setCurrentPhase('curl_input');
      dispatch(setInstagramBridgeRoomId(data.roomId));
    };

    // Listen for setup status updates
    const handleSetupStatus = (data) => {
      logger.info('[InstagramBridgeSetup] Received setup status via Socket.IO:', data);
      
      switch (data.state) {
        case 'curl_prompt':
          setCurrentPhase('curl_input');
          break;
        case 'curl_submitted':
          setCurrentPhase('connecting');
          setConnectionStatus('connecting');
          dispatch(setInstagramSetupState('connecting'));
          break;
        case 'puppet_sent':
          // Keep in connecting state, puppet command sent
          break;
        case 'connected':
          setConnectionStatus('connected');
          setCurrentPhase('success');
          dispatch(setInstagramConnected(true));
          dispatch(setInstagramSetupState('completed'));
          saveInstagramStatus(true);
          
          // Clear intervals and timeouts
          if (statusCheckInterval.current) {
            clearInterval(statusCheckInterval.current);
          }
          if (connectionTimeout.current) {
            clearTimeout(connectionTimeout.current);
          }
          
          toast.success('Instagram connected successfully!');
          logger.info('[InstagramBridgeSetup] Instagram connection successful via Socket.IO');
          break;
        case 'error':
          setCurrentPhase('error');
          setConnectionStatus('failed');
          setErrorMessage(data.message || 'Connection failed');
          if (statusCheckInterval.current) {
            clearInterval(statusCheckInterval.current);
          }
          break;
      }
    };

    // Register Socket.IO event listeners using the useSocketConnection's 'on' method
    const cleanupCurlPrompt = on('instagram:curl-prompt', handleCurlPrompt);
    const cleanupSetupStatus = on('instagram:setup:status', handleSetupStatus);

    // Cleanup on unmount
    return () => {
      cleanupCurlPrompt();
      cleanupSetupStatus();
    };
  }, [socket, isConnected, dispatch, on]);
  
  // Component cleanup
  useEffect(() => {
    return () => {
      if (statusCheckInterval.current) {
        clearInterval(statusCheckInterval.current);
      }
      if (connectionTimeout.current) {
        clearTimeout(connectionTimeout.current);
      }
    };
  }, []);

  // Initialize Instagram connection
  const initializeConnection = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage('');
      setInstructions('');
      logger.info('[InstagramBridgeSetup] Initializing Instagram connection (Step 1)');
      
      const response = await createInstagramApiCall('/api/v1/matrix/instagram/connect');
      
      if (response.data?.status === 'curl_prompt') {
        const { bridgeRoomId: roomId, message, instructions: newInstructions } = response.data;
        
        if (roomId) {
          setBridgeRoomId(roomId);
          dispatch(setInstagramBridgeRoomId(roomId));
          logger.info(`[InstagramBridgeSetup] Received bridgeRoomId: ${roomId}`);
        } else {
          throw new Error("Connection prompt received, but missing 'bridgeRoomId'.");
        }
        
        setInstructions(newInstructions || message || "Paste the cURL command you copied from your browser's Network tab.");
        setCurrentPhase('curl_input');
        logger.info('[InstagramBridgeSetup] Received cURL prompt, transitioning to cURL input phase.');
        
      } else {
        throw new Error(response.data?.message || 'Failed to initialize Instagram connection');
      }
    } catch (error) {
      logger.error('[InstagramBridgeSetup] Error during initialization (Step 1):', error);
      setErrorMessage(error.response?.data?.message || error.message || 'Failed to initialize connection');
      setCurrentPhase('error');
      dispatch(setInstagramError(error.message));
    } finally {
      setIsLoading(false);
    }
  }, [dispatch]);

  // Submit cURL command
  const submitCurlCommand = useCallback(async () => {
    if (!curlCommand.trim()) {
      setErrorMessage('Please enter a valid cURL command');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage('');
      setConnectionAttempts(prev => prev + 1);
      setLastAttemptTime(new Date());
      
      logger.info('[InstagramBridgeSetup] Submitting cURL command');
      
      const response = await createInstagramApiCall('/api/v1/matrix/instagram/connect', {
        curlCommand: curlCommand.trim(),
        bridgeRoomId
      });
      
      if (response.data?.success) {
        // FIX: Check if already connected from cURL submission
        if (response.data?.connected) {
          setCurrentPhase('success');
          setConnectionStatus('connected');
          dispatch(setInstagramConnected(true));
          dispatch(setInstagramSetupState('completed'));
          saveInstagramStatus(true);
          toast.success('Instagram connected successfully!');
          logger.info('[InstagramBridgeSetup] Instagram connection successful from cURL submission');
        } else {
          // Set connecting state, Socket.IO will handle the rest
          setCurrentPhase('connecting');
          setConnectionStatus('connecting');
          dispatch(setInstagramSetupState('connecting'));
          
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
      logger.error('[InstagramBridgeSetup] Error submitting cURL command:', error);
      
      // Enhanced error handling with specific backend error detection
      const errorMessage = error.response?.data?.message || error.message || 'Failed to process cURL command';
      
      // Check for specific backend error conditions and provide user-friendly guidance
      if (errorMessage.includes('Missing li_at or JSESSIONID cookie') || 
          errorMessage.includes('sessionid') || 
          errorMessage.includes('authentication') ||
          errorMessage.includes('invalid session') ||
          errorMessage.includes('unauthorized')) {
        setErrorMessage(`❌ Invalid cURL Command Detected
        
The cURL command you provided doesn't contain the required Instagram session cookies. This usually means:

🔍 **How to fix this:**
1. Make sure you're logged into Instagram in your browser
2. Go to Instagram Messages or Profile page to trigger network requests
3. Look for a POST request to 'graphql' or 'api/v1/direct_v2/inbox/' in the Network tab
4. The request should contain cookies like 'sessionid', 'csrftoken', etc.
5. Right-click on the correct request and "Copy as cURL"

💡 **Tip:** The cURL should be quite long (500+ characters) and contain multiple cookies.`);
      } else if (errorMessage.includes('Rate limit') || errorMessage.includes('too many requests')) {
        setErrorMessage(`⏰ Rate Limit Detected
        
Instagram is temporarily blocking requests. Please:

1. Wait 10-15 minutes before trying again
2. Make sure you're using a private/incognito browser window
3. Try using a different internet connection if possible`);
      } else if (errorMessage.includes('CSRF') || errorMessage.includes('csrf')) {
        setErrorMessage(`🔐 CSRF Token Issue
        
The cURL command is missing a valid CSRF token. Please:

1. Refresh your Instagram page
2. Find a fresh API request in the Network tab
3. Copy a new cURL command that includes the 'x-csrftoken' header`);
      } else if (errorMessage.includes('expired') || errorMessage.includes('session')) {
        setErrorMessage(`⏰ Session Expired
        
Your Instagram session has expired. Please:

1. Log out and log back into Instagram
2. Copy a fresh cURL command
3. Try the connection process again`);
      } else {
        // Generic error handling for other cases
        setErrorMessage(`Connection failed: ${errorMessage}
        
Please try again or check that your cURL command is correctly copied from the Network tab.`);
      }
      
      setCurrentPhase('error');
      setConnectionStatus('failed');
    } finally {
      setIsLoading(false);
    }
  }, [curlCommand, bridgeRoomId, dispatch]);

  // Start status checking
  const startStatusChecking = useCallback((roomId) => {
    if (statusCheckInterval.current) {
      clearInterval(statusCheckInterval.current);
    }
    
    statusCheckInterval.current = setInterval(async () => {
      try {
        const response = await createInstagramApiCall(`/api/v1/matrix/instagram/status/${roomId}`, null, 'GET');
        
        if (response.data?.connected) {
          setConnectionStatus('connected');
          setCurrentPhase('success');
          dispatch(setInstagramConnected(true));
          dispatch(setInstagramSetupState('completed'));
          
          // Save connection status
          saveInstagramStatus(true);
          
          clearInterval(statusCheckInterval.current);
          if (connectionTimeout.current) {
            clearTimeout(connectionTimeout.current);
          }
          
          toast.success('Instagram connected successfully!');
          logger.info('[InstagramBridgeSetup] Instagram connection successful');
          
        } else if (response.data?.status === 'failed') {
          setConnectionStatus('failed');
          setCurrentPhase('error');
          setErrorMessage(response.data?.message || 'Connection failed');
          clearInterval(statusCheckInterval.current);
        }
      } catch (error) {
        logger.error('[InstagramBridgeSetup] Status check error:', error);
        // Don't immediately fail on status check errors, keep trying
      }
    }, 3000); // Check every 3 seconds
  }, [dispatch]);

  // Handle retry
  const handleRetry = useCallback(() => {
    setCurrentPhase('instructions');
    setErrorMessage('');
    setCurlCommand('');
    setConnectionStatus('disconnected');
    setConnectionAttempts(0);
    setLastAttemptTime(null);
    setInstructions('');
    
    if (statusCheckInterval.current) {
      clearInterval(statusCheckInterval.current);
    }
    if (connectionTimeout.current) {
      clearTimeout(connectionTimeout.current);
    }
    
    dispatch(resetInstagramSetup());
  }, [dispatch]);

  // Handle completion
  const handleComplete = useCallback(() => {
    if (onComplete) {
      onComplete();
    }
  }, [onComplete]);

  // Copy cURL template
  const copyCurlTemplate = useCallback(() => {
    const template = `curl 'https://www.instagram.com/api/v1/direct_v2/inbox/' \\
  -H 'accept: */*' \\
  -H 'accept-language: en-US,en;q=0.9' \\
  -H 'cookie: YOUR_COOKIES_HERE' \\
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' \\
  -H 'x-csrftoken: YOUR_CSRF_TOKEN_HERE'`;
    
    navigator.clipboard.writeText(template);
    toast.success('cURL template copied to clipboard');
  }, []);

  // Render phase content
  const renderPhaseContent = () => {
    switch (currentPhase) {
      case 'instructions':
        return (
          <div className="space-y-6">
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
                <Terminal className="h-5 w-5 text-pink-500" />
                Step-by-Step Instructions
              </h3>
              
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3 p-3 bg-purple-50 dark:bg-purple-950 rounded-lg border border-purple-200">
                  <Badge variant="outline" className="mt-0.5 text-xs bg-purple-100 text-purple-800 border-purple-300">1</Badge>
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      <EyeOff className="h-4 w-4 text-purple-600" />
                      Open Instagram in Private/Incognito Window
                    </p>
                    <p className="text-muted-foreground mt-1">
                      <strong className="text-purple-700">IMPORTANT:</strong> Press Ctrl+Shift+N (Chrome) or Ctrl+Shift+P (Firefox) for a clean session
                    </p>
                    <p className="text-xs text-purple-600 mt-1">Navigate to instagram.com and log in to your account</p>
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
                    <p className="font-medium">Find the API Request</p>
                    <p className="text-muted-foreground mt-1">Look for a 'graphql' request with request URL: https://www.instagram.com/api/graphql (POST) <code></code> in the Network tab</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                  <Badge variant="outline" className="mt-0.5 text-xs">4</Badge>
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
              <Button onClick={initializeConnection} disabled={isLoading} className="flex-1">
                {isLoading ? 'Initializing...' : 'Start Connection Process'}
              </Button>
              <Button onClick={onCancel} variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        );

      case 'curl_input':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Code className="h-12 w-12 text-pink-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold">Paste Your cURL Command</h3>
              <p className="text-muted-foreground mt-2">
                {instructions || "Paste the cURL command you copied from your private/incognito browser's Network tab"}
              </p>
            </div>

            <Alert className="border-purple-200 bg-purple-50 dark:bg-purple-950">
              <EyeOff className="h-4 w-4 text-purple-600" />
              <AlertDescription>
                <div className="text-center">
                  <strong className="text-purple-800 dark:text-purple-200">🔒 REMINDER: Use Private/Incognito Window</strong>
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                    Ensure you copied the cURL from Instagram in a private/incognito browser window
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <label className="text-sm font-medium">cURL Command:</label>
              <Textarea
                value={curlCommand}
                onChange={(e) => setCurlCommand(e.target.value)}
                placeholder="curl 'https://www.instagram.com/api/v1/direct_v2/inbox/' -H 'accept: */*' ..."
                className="min-h-[120px] font-mono text-sm"
                disabled={isLoading}
              />
              {curlCommand && (
                <p className="text-xs text-muted-foreground">
                  ✓ cURL command detected ({curlCommand.length} characters)
                </p>
              )}
            </div>

            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription>
                <div className="space-y-3">
                  <strong className="text-blue-800 dark:text-blue-200">How to get the correct cURL command:</strong>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-blue-700 dark:text-blue-300">
                    <li className="flex items-start gap-2">
                      <span className="text-purple-600 font-bold">🔒</span>
                      <span>Open Instagram in a <strong className="text-purple-700 bg-purple-100 px-1 rounded">private/incognito browser window</strong> (Ctrl+Shift+N)</span>
                    </li>
                    <li>Log in to your Instagram account <em>(in the private window)</em></li>
                    <li>Open Developer Tools (Press F12)</li>
                    <li>Go to the <strong>Network</strong> tab</li>
                    <li>Navigate around Instagram (check messages, profile, etc.)</li>
                    <li>Look for a <strong>graphql</strong> request to <code>https://www.instagram.com/api/graphql</code></li>
                    <li>Right-click the request → Copy → <strong>Copy as cURL (bash)</strong></li>
                    <li>Paste the complete command above</li>
                  </ol>
                  
                  <div className="mt-3 p-3 bg-blue-100 dark:bg-blue-900 rounded">
                    <strong>Important Notes:</strong>
                    <ul className="text-sm mt-1 list-disc list-inside">
                      <li>Must include Instagram session cookies (sessionid, csrftoken)</li>
                      <li>Use "Copy as cURL (bash)" not cmd</li>
                      <li><strong className="text-purple-700">Always copy from private/incognito window</strong></li>
                      <li>Ensure you're logged into the correct Instagram account</li>
                    </ul>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950">
              <AlertTriangle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800 dark:text-blue-200">
                <strong>Security Note:</strong> This cURL command contains your session cookies. 
                Never share this with untrusted parties.
              </AlertDescription>
            </Alert>

            <div className="flex gap-3">
              <Button 
                onClick={submitCurlCommand} 
                disabled={!curlCommand.trim() || isLoading}
                className="flex-1"
              >
                {isLoading ? 'Connecting...' : 'Connect Instagram'}
              </Button>
              <Button onClick={() => setCurrentPhase('instructions')} variant="outline">
                Back
              </Button>
            </div>
          </div>
        );

      case 'connecting':
        return (
          <div className="space-y-6 text-center">
            <div className="space-y-4">
              <Clock className="h-12 w-12 text-pink-500 mx-auto animate-pulse" />
              <h3 className="text-lg font-semibold">Connecting to Instagram...</h3>
              <p className="text-muted-foreground">
                Please wait while we establish the connection. This may take up to 60 seconds.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
              <p className="text-xs text-muted-foreground">
                Attempt {connectionAttempts} • Started {lastAttemptTime?.toLocaleTimeString()}
              </p>
            </div>

            <Button onClick={handleRetry} variant="outline" size="sm">
              Cancel Connection
            </Button>
          </div>
        );

      case 'success':
        return (
          <div className="space-y-6 text-center">
            <div className="space-y-4">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
              <h3 className="text-lg font-semibold text-green-600">Instagram Connected Successfully!</h3>
              <p className="text-muted-foreground">
                Your Instagram account has been connected and is ready to use.
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
              <Button onClick={handleRetry} className="flex-1">
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
          <div className="w-6 h-6 bg-gradient-to-br from-pink-500 to-purple-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold">I</span>
          </div>
          Instagram Bridge Setup
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-6">
        {renderPhaseContent()}
      </CardContent>
    </Card>
  );
};

InstagramBridgeSetup.propTypes = {
  onComplete: PropTypes.func,
  onCancel: PropTypes.func
};

export default InstagramBridgeSetup; 