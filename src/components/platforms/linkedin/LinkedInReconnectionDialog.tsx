import React, { useState, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  Cookie, 
  Loader2, 
  AlertTriangle, 
  Clock, 
  Info, 
  RefreshCw,
  AlertCircle,
  EyeOff,
  Shield
} from 'lucide-react';
import { toast } from 'sonner';
import logger from '@/utils/logger';
import api from '@/utils/api';
import {
  setLinkedInConnected,
  setLinkedInSetupState
} from '@/store/slices/onboardingSlice';
import { saveLinkedInStatus } from '@/utils/connectionStorage';
import LinkedInTimer from '@/utils/linkedinTimer';

// LinkedIn-specific API base URL (same as linkedinBridgeSetup)
const LINKEDIN_API_BASE = 'https://dailyfix-api-gateway.duckdns.org';

// Create LinkedIn-specific API instance
const createLinkedInApiCall = (endpoint: string, data = null, method = 'POST') => {
  const originalBaseURL = api.defaults.baseURL;
  api.defaults.baseURL = LINKEDIN_API_BASE;
  
  const config = {
    url: endpoint,
    method,
    ...(data && { data })
  };
  
  const request = api(config).finally(() => {
    api.defaults.baseURL = originalBaseURL;
  });
  
  return request;
};

interface LinkedInReconnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const LinkedInReconnectionDialog: React.FC<LinkedInReconnectionDialogProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onCancel
}) => {
  const dispatch = useDispatch();
  
  // State management
  const [cookieHeader, setCookieHeader] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorType, setErrorType] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showDetailedHelp, setShowDetailedHelp] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [connectionPhase, setConnectionPhase] = useState<'input' | 'connecting' | 'success' | 'error'>('input');
  
  // Reset state when dialog opens/closes
  React.useEffect(() => {
    if (isOpen) {
      // Reset all state when dialog opens
      setCookieHeader('');
      setErrorMessage('');
      setErrorType(null);
      setValidationErrors([]);
      setShowDetailedHelp(false);
      setRetryCountdown(0);
      setConnectionPhase('input');
    }
  }, [isOpen]);
  
  // Handle cookie submission with same logic as linkedinBridgeSetup
  const submitCookieHeader = useCallback(async () => {
    if (!cookieHeader.trim()) {
      setErrorMessage('Please enter a valid Cookie header');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage('');
      setErrorType(null);
      setValidationErrors([]);
      setShowDetailedHelp(false);
      setConnectionPhase('connecting');
      
      logger.info('[LinkedInReconnectionDialog] Submitting Cookie header for reconnection');
      
      const response = await createLinkedInApiCall('/api/v1/matrix/linkedin/connect', {
        cookieHeader: cookieHeader.trim(),
        loginMethod: 'cookie'
      });
      
      if (response.data?.success || response.data?.connected) {
        // Connection successful
        setConnectionPhase('success');
        
        // Update Redux state
        dispatch(setLinkedInConnected(true));
        dispatch(setLinkedInSetupState('completed'));
        
        // Update connection storage
        saveLinkedInStatus(true);
        
        // Update LinkedIn timer - record successful check and cache status
        LinkedInTimer.recordLinkedInCheck();
        LinkedInTimer.setCachedLinkedInStatus(true);
        
        toast.success('LinkedIn reconnected successfully!');
        logger.info('[LinkedInReconnectionDialog] LinkedIn reconnection successful');
        
        // Close dialog and call success callback
        setTimeout(() => {
          onClose();
          if (onSuccess) {
            onSuccess();
          }
        }, 1500);
        
      } else {
        throw new Error(response.data?.message || 'Failed to process Cookie header');
      }
    } catch (error) {
      logger.error('[LinkedInReconnectionDialog] Error submitting Cookie header:', error);
      
      // Intelligent error handling (same as linkedinBridgeSetup)
      const backendErrorMessage = error.response?.data?.message || error.message || 'Failed to process Cookie header';
      
      let detectedErrorType = null;
      let userFriendlyMessage = '';
      let validationErrorsList = [];
      
      if (backendErrorMessage.includes('Missing li_at or JSESSIONID') ||
          backendErrorMessage.includes('li_at') || 
          backendErrorMessage.includes('JSESSIONID') ||
          backendErrorMessage.includes('missing required cookies') ||
          backendErrorMessage.includes('authentication cookies not found')) {
        detectedErrorType = 'invalid_cookie_missing';
        userFriendlyMessage = 'The Cookie header is missing required LinkedIn session cookies (li_at or JSESSIONID)';
        validationErrorsList = [
          'Missing required LinkedIn cookies (li_at or JSESSIONID)',
          'Please copy complete Cookie header from an active LinkedIn session',
          'Ensure you are logged into LinkedIn in your browser',
          'Copy from a request to linkedin.com domain'
        ];
      } else if (backendErrorMessage.includes('Rate limit') || 
                 backendErrorMessage.includes('too many requests') ||
                 backendErrorMessage.includes('rate limited')) {
        detectedErrorType = 'rate_limited';
        userFriendlyMessage = 'LinkedIn is rate limiting requests';
        validationErrorsList = [
          'LinkedIn is rate limiting requests',
          'Please wait 5 minutes before trying again',
          'Use a private/incognito browser window',
          'This is temporary and will resolve automatically'
        ];
        setRetryCountdown(300); // 5 minutes
        startRetryCountdown();
      } else if (backendErrorMessage.includes('expired') || 
                 backendErrorMessage.includes('session expired') ||
                 backendErrorMessage.includes('invalid session')) {
        detectedErrorType = 'session_expired';
        userFriendlyMessage = 'Your LinkedIn session has expired';
        validationErrorsList = [
          'Your LinkedIn session has expired',
          'Please log out and log back into LinkedIn',
          'Get a fresh Cookie header from the Network tab',
          'Ensure you are copying from an active session'
        ];
      } else if (backendErrorMessage.includes('malformed') ||
                 backendErrorMessage.includes('invalid cookie') ||
                 backendErrorMessage.includes('parse error') ||
                 backendErrorMessage.includes('invalid format')) {
        detectedErrorType = 'malformed_cookie';
        userFriendlyMessage = 'The Cookie header is incomplete or malformed';
        validationErrorsList = [
          'The Cookie header is incomplete or malformed',
          'Ensure you copy the COMPLETE Cookie header value',
          'Include all cookie values (li_at, JSESSIONID, etc.)',
          'Do not include the "Cookie: " prefix, just the values'
        ];
      } else {
        detectedErrorType = 'auth_failed';
        userFriendlyMessage = `Connection failed: ${backendErrorMessage}`;
        validationErrorsList = [
          'An unexpected error occurred during authentication',
          'Please try with a fresh Cookie header',
          'Ensure you copied from an active LinkedIn session',
          'Check that the Cookie contains proper LinkedIn cookies'
        ];
      }
      
      // Apply error handling
      setErrorMessage(userFriendlyMessage);
      setErrorType(detectedErrorType);
      setValidationErrors(validationErrorsList);
      setShowDetailedHelp(true);
      setConnectionPhase('error');
      
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
  }, [cookieHeader, dispatch, onClose, onSuccess]);
  
  // Start retry countdown for rate limiting
  const startRetryCountdown = useCallback(() => {
    const interval = setInterval(() => {
      setRetryCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setShowDetailedHelp(false);
          setValidationErrors([]);
          toast.success('You can now retry the connection.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);
  
  // Clear error and allow retry
  const clearErrorAndRetry = useCallback(() => {
    setErrorMessage('');
    setErrorType(null);
    setValidationErrors([]);
    setShowDetailedHelp(false);
    setConnectionPhase('input');
  }, []);
  
  // Handle dialog close
  const handleClose = useCallback(() => {
    setRetryCountdown(0);
    onClose();
  }, [onClose]);
  
  // Handle cancel
  const handleCancel = useCallback(() => {
    if (onCancel) {
      onCancel();
    }
    handleClose();
  }, [onCancel, handleClose]);
  
  // Render content based on connection phase
  const renderContent = () => {
    switch (connectionPhase) {
      case 'connecting':
        return (
          <div className="space-y-4 text-center">
            <div className="space-y-2">
              <Loader2 className="h-8 w-8 text-blue-500 mx-auto animate-spin" />
              <h4 className="text-sm font-medium">Reconnecting to LinkedIn...</h4>
              <p className="text-xs text-muted-foreground">
                Please wait while we restore your LinkedIn connection.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
            </div>
          </div>
        );
        
      case 'success':
        return (
          <div className="space-y-4 text-center">
            <div className="space-y-2">
              <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Cookie className="h-4 w-4 text-green-600" />
              </div>
              <h4 className="text-sm font-medium text-green-600">LinkedIn Reconnected!</h4>
              <p className="text-xs text-muted-foreground">
                Your LinkedIn connection has been restored successfully.
              </p>
            </div>
          </div>
        );
        
      case 'error':
      case 'input':
      default:
        return (
          <div className="space-y-4">
            {/* Private Window Alert */}
            <Alert className="border-purple-200 bg-purple-50 dark:bg-purple-950">
              <EyeOff className="h-4 w-4 text-purple-600" />
              <AlertDescription>
                <div className="text-center">
                  <strong className="text-purple-800 dark:text-purple-200 text-sm">Use Private/Incognito Window</strong>
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                    Copy Cookie from a private/incognito LinkedIn session for best results
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription>
                  <div className="space-y-2">
                    <strong className="text-orange-800 dark:text-orange-200 text-sm">
                      {errorType === 'invalid_cookie_missing' && 'Missing LinkedIn Cookies'}
                      {errorType === 'session_expired' && 'Session Expired'}
                      {errorType === 'malformed_cookie' && 'Invalid Cookie Format'}
                      {errorType === 'rate_limited' && 'Rate Limited'}
                      {errorType === 'auth_failed' && 'Authentication Failed'}
                      {!errorType && 'Connection Issue'}
                    </strong>
                    <ul className="list-disc list-inside space-y-1 text-orange-700 dark:text-orange-300">
                      {validationErrors.map((error, index) => (
                        <li key={index} className="text-xs">{error}</li>
                      ))}
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Rate Limit Countdown */}
            {retryCountdown > 0 && (
              <Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950">
                <Clock className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Please wait before retrying:</span>
                    <Badge variant="outline" className="text-yellow-800 border-yellow-300 text-xs">
                      {Math.floor(retryCountdown / 60)}:{(retryCountdown % 60).toString().padStart(2, '0')}
                    </Badge>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Cookie Input */}
            <div className="space-y-3">
              <label className="text-sm font-medium">LinkedIn Cookie Header:</label>
              <Textarea
                value={cookieHeader}
                onChange={(e) => setCookieHeader(e.target.value)}
                placeholder="li_at=AQEDATjhVXgBT...; JSESSIONID=ajax:123...; bcookie=v=2&456..."
                className={`min-h-[100px] font-mono text-sm ${
                  validationErrors.length > 0 ? 'border-orange-300 focus:border-orange-500' : ''
                }`}
                disabled={isLoading || retryCountdown > 0}
              />
              {cookieHeader && (
                <p className="text-xs text-muted-foreground">
                  ✓ Cookie header detected ({cookieHeader.length} characters)
                </p>
              )}
            </div>

            {/* Detailed Help */}
            {showDetailedHelp && (
              <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950">
                <Info className="h-4 w-4 text-blue-600" />
                <AlertDescription>
                  <div className="space-y-3">
                    <strong className="text-blue-800 dark:text-blue-200 text-sm">How to get the Cookie header:</strong>
                    <ol className="list-decimal list-inside space-y-1 text-xs text-blue-700 dark:text-blue-300">
                      <li className="flex items-start gap-2">
                        <span className="text-purple-600 font-bold">🔒</span>
                        <span>Open LinkedIn in <strong className="text-purple-700 bg-purple-100 px-1 rounded">private/incognito</strong> window</span>
                      </li>
                      <li>Log in to your LinkedIn account</li>
                      <li>Open Developer Tools (F12) → Network tab</li>
                      <li>Go to LinkedIn Messages</li>
                      <li>Find a request to linkedin.com → Headers tab</li>
                      <li>Copy the complete Cookie header value</li>
                    </ol>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Error message for non-detailed errors */}
            {errorMessage && !showDetailedHelp && (
              <Alert className="border-red-200 bg-red-50 dark:bg-red-950">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800 dark:text-red-200 text-sm">
                  {errorMessage}
                </AlertDescription>
              </Alert>
            )}

            {/* Show detailed help toggle */}
            {!showDetailedHelp && validationErrors.length > 0 && (
              <div className="text-center">
                <Button 
                  onClick={() => setShowDetailedHelp(true)} 
                  variant="ghost" 
                  size="sm"
                  className="text-blue-600 hover:text-blue-800 text-xs"
                >
                  <Info className="h-3 w-3 mr-1" />
                  Show detailed Cookie guide
                </Button>
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <div className="w-5 h-5 bg-gradient-to-br from-blue-500 to-blue-700 rounded flex items-center justify-center">
              <span className="text-white text-xs font-bold">L</span>
            </div>
            LinkedIn Reconnection Required
          </AlertDialogTitle>
          <AlertDialogDescription>
            Your LinkedIn session has expired. Please reconnect to continue using LinkedIn messaging.
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <div className="py-4">
          {renderContent()}
        </div>
        
        <AlertDialogFooter>
          {connectionPhase === 'input' || connectionPhase === 'error' ? (
            <>
              {validationErrors.length > 0 && !isLoading && retryCountdown === 0 && (
                <Button 
                  onClick={clearErrorAndRetry} 
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-1"
                >
                  <RefreshCw className="h-3 w-3" />
                  Clear Error
                </Button>
              )}
              <AlertDialogCancel onClick={handleCancel} disabled={isLoading}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction 
                onClick={submitCookieHeader}
                disabled={!cookieHeader.trim() || isLoading || retryCountdown > 0}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Connecting...
                  </>
                ) : retryCountdown > 0 ? (
                  `Wait ${Math.floor(retryCountdown / 60)}:${(retryCountdown % 60).toString().padStart(2, '0')}`
                ) : (
                  'Reconnect LinkedIn'
                )}
              </AlertDialogAction>
            </>
          ) : connectionPhase === 'connecting' ? (
            <AlertDialogCancel onClick={handleCancel} disabled>
              Please wait...
            </AlertDialogCancel>
          ) : (
            <AlertDialogAction onClick={handleClose}>
              Continue
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default LinkedInReconnectionDialog; 