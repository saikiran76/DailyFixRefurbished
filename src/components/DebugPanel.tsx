import React from 'react';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLogger } from '@/hooks/useLogger';

/**
 * Debug panel component to help diagnose authentication and routing issues
 * Only rendered in development mode
 */
const DebugPanel: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const logger = useLogger();
  
  // Get auth and onboarding state from Redux
  const authState = useSelector((state: any) => state.auth);
  const onboardingState = useSelector((state: any) => state.onboarding);
  
  // Only show in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  
  // Format session data safely
  const formatSession = (session: any) => {
    if (!session) return 'No session';
    
    try {
      return {
        userId: session.user?.id,
        email: session.user?.email,
        expires: new Date(session.expires_at * 1000).toLocaleString(),
      };
    } catch (e) {
      return 'Error formatting session';
    }
  };
  
  const handleForceRedirect = (path: string) => {
    logger.info(`[DebugPanel] Forcing redirect to ${path}`);
    window.location.href = path;
  };
  
  const handleClearLocalStorage = () => {
    logger.info('[DebugPanel] Clearing localStorage');
    try {
      localStorage.clear();
      window.location.reload();
    } catch (e) {
      logger.error('[DebugPanel] Error clearing localStorage:', e);
    }
  };
  
  return (
    <Card className="fixed bottom-4 right-4 w-96 shadow-lg bg-black/90 text-white border-red-500 z-50 text-xs">
      <CardHeader className="py-2 px-4 bg-red-600 text-white">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Debug Panel</span>
          <span className="text-xs opacity-70">{new Date().toLocaleTimeString()}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 text-xs overflow-auto max-h-[400px]">
        <div className="space-y-2">
          <div>
            <div className="font-bold mb-1">Current Route:</div>
            <div className="bg-black/20 p-1 rounded">{location.pathname}{location.search}</div>
          </div>
          
          <div>
            <div className="font-bold mb-1">Auth State:</div>
            <div className="bg-black/20 p-1 rounded overflow-x-auto">
              <pre>{JSON.stringify({
                hasSession: !!authState.session,
                sessionDetails: formatSession(authState.session),
                loading: authState.loading,
                hasInitialized: authState.hasInitialized
              }, null, 2)}</pre>
            </div>
          </div>
          
          <div>
            <div className="font-bold mb-1">Onboarding State:</div>
            <div className="bg-black/20 p-1 rounded overflow-x-auto">
              <pre>{JSON.stringify({
                isComplete: onboardingState.isComplete,
                currentStep: onboardingState.currentStep,
                matrixConnected: onboardingState.matrixConnected,
                whatsappConnected: onboardingState.whatsappConnected
              }, null, 2)}</pre>
            </div>
          </div>
          
          <div className="pt-2">
            <div className="font-bold mb-1">Actions:</div>
            <div className="grid grid-cols-2 gap-2">
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={handleClearLocalStorage}
                className="text-xs"
              >
                Clear localStorage
              </Button>
              <Button 
                variant="default" 
                size="sm" 
                onClick={() => window.location.reload()}
                className="text-xs"
              >
                Force Reload
              </Button>
            </div>
            
            <div className="grid grid-cols-3 gap-2 mt-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handleForceRedirect('/login')}
                className="text-xs"
              >
                Go to Login
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handleForceRedirect('/onboarding')}
                className="text-xs"
              >
                Go to Onboarding
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handleForceRedirect('/dashboard')}
                className="text-xs"
              >
                Go to Dashboard
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DebugPanel; 