import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Bell, Volume2, VolumeX, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { toast } from 'react-hot-toast';
import logger from '@/utils/logger';

interface NotificationSettingsProps {
  notificationManager?: {
    hasPermission: NotificationPermission;
    isAudioEnabled: boolean;
    requestNotificationPermission: () => Promise<NotificationPermission>;
    playNotificationSound: (platform: 'whatsapp' | 'telegram') => Promise<void>;
    setIsAudioEnabled: (enabled: boolean) => void;
  };
}

export function NotificationSettings({ notificationManager }: NotificationSettingsProps) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState([70]);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);

  // Initialize settings from notification manager
  useEffect(() => {
    if (notificationManager) {
      setSoundEnabled(notificationManager.isAudioEnabled);
      setBrowserNotificationsEnabled(notificationManager.hasPermission === 'granted');
    }
  }, [notificationManager]);

  // Handle sound toggle
  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    if (notificationManager) {
      notificationManager.setIsAudioEnabled(enabled);
      
      if (enabled) {
        toast.success('Notification sounds enabled', {
          icon: '🔊',
          duration: 2000,
        });
      } else {
        toast.success('Notification sounds disabled', {
          icon: '🔇',
          duration: 2000,
        });
      }
    }
  };

  // Handle browser notification permission request
  const handleBrowserNotificationToggle = async (enabled: boolean) => {
    if (!enabled) {
      setBrowserNotificationsEnabled(false);
      toast.success('Browser notifications disabled', {
        icon: '🔕',
        duration: 2000,
      });
      return;
    }

    if (!notificationManager) {
      toast.error('Notification manager not available');
      return;
    }

    setIsRequestingPermission(true);
    
    try {
      const permission = await notificationManager.requestNotificationPermission();
      
      if (permission === 'granted') {
        setBrowserNotificationsEnabled(true);
        toast.success('Browser notifications enabled! You\'ll now receive notifications even when the app is in the background.', {
          icon: '🔔',
          duration: 4000,
        });
      } else if (permission === 'denied') {
        setBrowserNotificationsEnabled(false);
        toast.error('Browser notifications were denied. You can enable them in your browser settings.', {
          icon: '❌',
          duration: 5000,
        });
      } else {
        setBrowserNotificationsEnabled(false);
        toast('Browser notification permission is required for this feature.', {
          icon: '⚠️',
          duration: 3000,
        });
      }
    } catch (error) {
      logger.error('[NotificationSettings] Error requesting permission:', error);
      setBrowserNotificationsEnabled(false);
      toast.error('Failed to request notification permission');
    } finally {
      setIsRequestingPermission(false);
    }
  };

  // Test notification sounds
  const testSound = async (platform: 'whatsapp' | 'telegram') => {
    if (!notificationManager || !soundEnabled) {
      toast.error('Sound notifications are disabled');
      return;
    }

    try {
      await notificationManager.playNotificationSound(platform);
      toast.success(`${platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'} notification sound played`, {
        icon: platform === 'whatsapp' ? '💚' : '💙',
        duration: 2000,
      });
    } catch (error) {
      logger.error(`[NotificationSettings] Error playing ${platform} sound:`, error);
      toast.error(`Failed to play ${platform} notification sound`);
    }
  };

  // Get permission status badge
  const getPermissionBadge = () => {
    if (!notificationManager) return null;

    switch (notificationManager.hasPermission) {
      case 'granted':
        return (
          <Badge variant="default" className="bg-green-500 text-white">
            <CheckCircle className="w-3 h-3 mr-1" />
            Granted
          </Badge>
        );
      case 'denied':
        return (
          <Badge variant="destructive">
            <XCircle className="w-3 h-3 mr-1" />
            Denied
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Not Set
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Notification Settings
          </CardTitle>
          <CardDescription>
            Configure how you receive notifications for new messages
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Sound Notifications */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="sound-notifications" className="text-base font-medium">
                  Sound Notifications
                </Label>
                <p className="text-sm text-muted-foreground">
                  Play notification sounds when new messages arrive
                </p>
              </div>
              <Switch
                id="sound-notifications"
                checked={soundEnabled}
                onCheckedChange={handleSoundToggle}
              />
            </div>

            {soundEnabled && (
              <div className="ml-4 space-y-4 border-l-2 border-muted pl-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Volume</Label>
                  <div className="flex items-center gap-4">
                    <VolumeX className="w-4 h-4 text-muted-foreground" />
                    <Slider
                      value={soundVolume}
                      onValueChange={setSoundVolume}
                      max={100}
                      step={10}
                      className="flex-1"
                    />
                    <Volume2 className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground w-12">
                      {soundVolume[0]}%
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Test Sounds</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testSound('whatsapp')}
                      className="text-green-600 border-green-200 hover:bg-green-50"
                    >
                      <Volume2 className="w-3 h-3 mr-1" />
                      WhatsApp
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testSound('telegram')}
                      className="text-blue-600 border-blue-200 hover:bg-blue-50"
                    >
                      <Volume2 className="w-3 h-3 mr-1" />
                      Telegram
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Browser Notifications */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="browser-notifications" className="text-base font-medium">
                  Browser Notifications
                </Label>
                <p className="text-sm text-muted-foreground">
                  Show desktop notifications even when the app is in the background
                </p>
              </div>
              <div className="flex items-center gap-2">
                {getPermissionBadge()}
                <Switch
                  id="browser-notifications"
                  checked={browserNotificationsEnabled}
                  onCheckedChange={handleBrowserNotificationToggle}
                  disabled={isRequestingPermission}
                />
              </div>
            </div>

            {notificationManager?.hasPermission === 'denied' && (
              <div className="ml-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-orange-800">
                      Browser notifications are blocked
                    </p>
                    <p className="text-orange-700 mt-1">
                      To enable notifications, click the notification icon in your browser's address bar 
                      and select "Allow", or check your browser settings.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {browserNotificationsEnabled && notificationManager?.hasPermission === 'granted' && (
              <div className="ml-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-green-800">
                      Browser notifications are enabled
                    </p>
                    <p className="text-green-700 mt-1">
                      You'll receive desktop notifications for new messages even when the app is minimized.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Mobile Support Note */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-2">
              <Bell className="w-4 h-4 text-blue-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-blue-800">
                  Mobile & Desktop Support
                </p>
                <p className="text-blue-700 mt-1">
                  Notification sounds and browser notifications work on both mobile and desktop devices. 
                  On mobile, make sure your browser allows notifications and sounds are not muted.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 