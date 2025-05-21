import { useState, useEffect } from 'react';
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import platformManager from '@/services/PlatformManager';
import { useSelector } from 'react-redux';

// Define the component for the platform list item
const PlatformItem = ({ 
  platform, 
  isConnected, 
  onToggle, 
  logo, 
  title, 
  subtitle,
  requiresAuth
}: { 
  platform: string; 
  isConnected: boolean; 
  onToggle: (platform: string, enabled: boolean) => void;
  logo: React.ReactNode;
  title: string;
  subtitle: string;
  requiresAuth?: boolean;
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-6 border-b border-gray-800">
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-gray-800 text-white">
          {logo}
        </div>
        <div>
          <h3 className="text-base font-medium">{title}</h3>
          <p className="text-sm text-gray-400">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {requiresAuth && !isConnected && (
          <span className="text-sm text-yellow-500 mr-2">Auth required</span>
        )}
        <Checkbox 
          id={`toggle-${platform}`}
          checked={isConnected}
          onCheckedChange={(checked) => onToggle(platform, checked as boolean)}
          className="data-[state=checked]:bg-blue-600"
        />
      </div>
    </div>
  );
};

// Main settings component
const PlatformSettings = () => {
  const [availablePlatforms] = useState(platformManager.availablePlatforms);
  const [activePlatform, setActivePlatform] = useState<string | null>(platformManager.getActivePlatform());
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Get onboarding state from Redux for connection status
  const onboardingState = useSelector((state: any) => state.onboarding);
  const { matrixConnected, whatsappConnected } = onboardingState;
  
  // Convert connection state to a map for easier access
  const connectionState = {
    'telegram': matrixConnected,  // Telegram uses Matrix connection
    'whatsapp': whatsappConnected
  };

  // Handle toggling a platform on/off
  const handleTogglePlatform = async (platform: string, enabled: boolean) => {
    try {
      if (enabled) {
        // Attempt to switch to this platform
        await platformManager.switchPlatform(platform);
        setActivePlatform(platformManager.getActivePlatform());
      } else if (platform === activePlatform) {
        // If disabling the active platform, clean it up
        await platformManager.cleanupPlatform(platform);
        setActivePlatform(platformManager.getActivePlatform());
      }
      
      // In a real app, you'd dispatch actions here to update Redux state
      console.log(`Platform ${platform} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error(`Error toggling platform ${platform}:`, error);
    }
  };

  // Handle refreshing all platform connections
  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    
    try {
      // In a real app, this would make API calls to refresh connections
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate network request
      console.log('Refreshed all platform connections');
    } catch (error) {
      console.error('Error refreshing connections:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Platform-specific metadata
  const platformMeta = {
    'telegram': {
      title: 'Telegram',
      subtitle: 'Connect your Telegram account',
      logo: <span className="text-blue-400 text-xl">T</span>,
      requiresAuth: true
    },
    'whatsapp': {
      title: 'WhatsApp',
      subtitle: '+91 91778 14689',
      logo: <span className="text-green-400 text-xl">W</span>,
      requiresAuth: true
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold uppercase tracking-wide text-gray-200">ACCOUNTS</h2>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleRefreshAll} 
          disabled={isRefreshing}
          className="text-sm"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh All
        </Button>
      </div>
      
      <div className="rounded-lg border border-gray-800 overflow-hidden bg-black/50">
        {availablePlatforms.map(platform => {
          const meta = platformMeta[platform as keyof typeof platformMeta];
          return (
            <PlatformItem
              key={platform}
              platform={platform}
              isConnected={connectionState[platform as keyof typeof connectionState] || false}
              onToggle={handleTogglePlatform}
              logo={meta.logo}
              title={meta.title}
              subtitle={meta.subtitle}
              requiresAuth={meta.requiresAuth}
            />
          );
        })}
      </div>
      
      <div className="text-sm text-gray-400 mt-4">
        <p>Connect your messaging platforms to manage all your conversations in one place.</p>
        <p className="mt-2">Platforms may require additional authentication steps to connect.</p>
      </div>
    </div>
  );
};

export default PlatformSettings; 