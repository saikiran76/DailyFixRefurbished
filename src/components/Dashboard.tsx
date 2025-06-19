import React, { useState, useMemo, useEffect } from 'react';
import '@/index.css';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { FaWhatsapp, FaTelegram } from "react-icons/fa";
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  MessageCircle, 
  Activity,
  Calendar,
  Clock,
  Star,
  Loader2,
  Settings,
  ChevronDown,
  ExternalLink,
  RefreshCw
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Import our hooks and services
import { usePlatformConnection } from '@/hooks/usePlatformConnection';
import { useAnalyticsData } from '@/hooks/useAnalyticsData';
import api from '@/utils/api';
import { isWhatsAppConnected, isTelegramConnected } from '@/utils/connectionStorage';
// Import Redux contact slice actions and selectors
import { 
  fetchContacts, 
  freshSyncContacts,
  selectAllContacts,
  selectContactsLoading,
  selectContactsError,
  selectInitialLoadComplete
} from '@/store/slices/contactSlice';
import platformManager from '@/services/PlatformManager';
import logger from '@/utils/logger';

// Import Priority Stats Card
import PriorityStatsCard from '@/components/dashboard/PriorityStatsCard';

// Define interfaces for type safety
interface Contact {
  id: string;
  display_name: string;
  name?: string;
  avatar_url?: string;
  last_message?: string;
  last_message_at?: string;
  whatsapp_id?: string;
  telegram_id?: string;
  platform?: 'whatsapp' | 'telegram';
}

interface ContactsState {
  whatsappContacts: Contact[];
  telegramContacts: Contact[];
  isLoadingWhatsApp: boolean;
  isLoadingTelegram: boolean;
  errorWhatsApp: string | null;
  errorTelegram: string | null;
}

// Empty State Component
const EmptyDashboardState = () => {
  return (
    <div className="flex-1 h-full overflow-y-auto">
      <div className="space-y-8 p-8 pb-16 max-w-4xl mx-auto">
        <div className="text-center py-12">
          <img 
            src="https://cdni.iconscout.com/illustration/premium/thumb/nothing-here-yet-illustration-download-in-svg-png-gif-file-formats--404-page-not-found-planet-space-empty-state-pack-science-technology-illustrations-6763396.png"
            alt="Nothing here yet"
            className="w-64 h-64 mx-auto mb-8 opacity-80"
          />
          <h2 className="text-3xl font-bold mb-4">Nothing here yet</h2>
          <p className="text-muted-foreground text-lg mb-8 max-w-md mx-auto">
            Connect to WhatsApp or Telegram to start viewing your messaging analytics and insights.
          </p>
          <Button size="lg" className="gap-2">
            <Settings className="h-5 w-5" />
            Connect Platforms
          </Button>
        </div>
      </div>
    </div>
  );
};

const PlatformStatsCards = ({ analyticsData }: { analyticsData: any }) => {
  const platformConnection = usePlatformConnection();

  if (platformConnection.isLoading || analyticsData.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="whatsapp-glowing-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 bg-muted animate-pulse rounded mb-2" />
              <div className="h-3 w-20 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const stats = analyticsData.stats;
  const platformData = platformConnection;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Connected Platforms Card */}
      <Card className="whatsapp-glowing-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Connected Platforms</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{platformData.totalConnected}</div>
          <p className="text-xs text-muted-foreground">
            {platformData.totalConnected === 2 ? 'All platforms active' : 
             platformData.totalConnected === 1 ? '1 platform connected' : 
             'No platforms connected'}
          </p>
        </CardContent>
      </Card>

      {/* Total Contacts Card */}
      <Card className="whatsapp-glowing-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Contacts</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats?.total_contacts || 0}</div>
          <p className="text-xs text-muted-foreground">
            Across all platforms
          </p>
        </CardContent>
      </Card>

      {/* Total Messages Card */}
      <Card className="whatsapp-glowing-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Messages This Week</CardTitle>
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats?.total_messages_week || 0}</div>
          <p className="text-xs text-muted-foreground">
            <span className="text-green-500">↗ Real-time data</span>
          </p>
        </CardContent>
      </Card>

      {/* Active Conversations Card */}
      <Card className="whatsapp-glowing-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Platform Activity</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {(stats?.platform_stats.whatsapp.total_contacts || 0) + (stats?.platform_stats.telegram.total_contacts || 0) > 0 ? 'Active' : 'Inactive'}
          </div>
          <p className="text-xs text-muted-foreground">
            Real-time status
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

const PlatformOverview = ({ analyticsData }: { analyticsData: any }) => {
  const platformConnection = usePlatformConnection();
  const stats = analyticsData.stats;

  const platformDetails = [
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      connected: platformConnection.whatsappConnected,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      contactCount: stats?.platform_stats.whatsapp.total_contacts || 0,
      messageCount: stats?.platform_stats.whatsapp.total_messages_week || 0
    },
    {
      id: 'telegram', 
      name: 'Telegram',
      connected: platformConnection.telegramConnected,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      contactCount: stats?.platform_stats.telegram.total_contacts || 0,
      messageCount: stats?.platform_stats.telegram.total_messages_week || 0
    }
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {platformDetails.map((platform) => {
        const IconComponent = platform.id === 'whatsapp' ? FaWhatsapp : FaTelegram;
        
        return (
          <Card key={platform.id} className="whatsapp-glowing-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className={`p-2 rounded-lg ${platform.bgColor}`}>
                    <IconComponent className={`h-5 w-5 ${platform.color}`} />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{platform.name}</CardTitle>
                    <CardDescription>
                      {platform.connected ? 'Connected' : 'Disconnected'}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="default" className={platform.connected ? "bg-green-500/10 text-green-500" : "bg-gray-500/10 text-gray-500"}>
                  {platform.connected ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Contacts</p>
                  <p className="text-2xl font-bold">{platform.contactCount}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Messages (Week)</p>
                  <p className="text-2xl font-bold">{platform.messageCount}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Progress 
                  value={platform.connected ? (platform.contactCount > 0 ? 75 : 25) : 0} 
                  className="flex-1" 
                />
                <span className="text-sm text-muted-foreground">
                  {platform.connected ? (platform.contactCount > 0 ? '75% active' : '25% active') : '0% active'}
                </span>
              </div>
            </CardContent>
            <CardFooter>
              <div className="flex items-center space-x-2 text-sm">
                <TrendingUp className="h-4 w-4 text-green-500" />
                <span className="text-green-500">Live data</span>
                <span className="text-muted-foreground">from API</span>
              </div>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
};

// Hook for fetching real contacts using Redux contactSlice
const useReduxContacts = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector((state: any) => state.auth.session?.user);
  const platformConnection = usePlatformConnection();
  
  // Redux selectors
  const allContacts = useSelector(selectAllContacts);
  const isLoading = useSelector(selectContactsLoading);
  const error = useSelector(selectContactsError);
  const initialLoadComplete = useSelector(selectInitialLoadComplete);

  // FIXED: Add contact caching mechanism - Part of issue D fix
  const [lastFetchTime, setLastFetchTime] = useState<Record<string, number>>({});
  const FETCH_COOLDOWN = 30 * 1000; // 30 seconds cooldown between fetches

  const canFetch = (platform: string): boolean => {
    const lastFetch = lastFetchTime[platform] || 0;
    const now = Date.now();
    return (now - lastFetch) > FETCH_COOLDOWN;
  };

  const updateFetchTime = (platform: string) => {
    setLastFetchTime(prev => ({
      ...prev,
      [platform]: Date.now()
    }));
  };

  // Helper function to filter out bot contacts
  const isNotBotContact = (contact: any): boolean => {
    const displayName = (contact.display_name || '').toLowerCase();
    return !displayName.includes('bot') && 
           !displayName.includes('bridge') && 
           !displayName.includes('status') &&
           !displayName.includes('broadcast');
  };

  // Memoized WhatsApp contacts
  const whatsappContacts = useMemo(() => {
    const rawWhatsAppContacts = allContacts.filter((contact: any) => 
      contact.platform === 'whatsapp' || 
      contact.whatsapp_id
    );
    
    const filteredWhatsAppContacts = rawWhatsAppContacts.filter(contact => 
      isNotBotContact(contact)
    );
    
    console.log('[Dashboard] WhatsApp contacts filtering:', {
      rawCount: rawWhatsAppContacts.length,
      filteredCount: filteredWhatsAppContacts.length,
      rawContacts: rawWhatsAppContacts.map(c => ({ 
        id: c.id, 
        name: c.display_name || c.name, 
        platform: c.platform,
        whatsapp_id: c.whatsapp_id 
      })),
      filteredContacts: filteredWhatsAppContacts.map(c => ({ 
        id: c.id, 
        name: c.display_name || c.name 
      }))
    });
    
    return filteredWhatsAppContacts.map((contact: any) => ({
      id: contact.id,
      display_name: contact.display_name || contact.name || 'Unknown Contact',
      avatar_url: contact.avatar_url,
      last_message: contact.last_message,
      last_message_at: contact.last_message_at,
      whatsapp_id: contact.whatsapp_id,
      platform: 'whatsapp' as const
    }));
  }, [allContacts]);

  const telegramContacts = useMemo(() => {
    const rawTelegramContacts = allContacts.filter((contact: any) => 
      contact.platform === 'telegram' || 
      contact.telegram_id
    );
    
    const filteredTelegramContacts = rawTelegramContacts.filter(contact => 
      isNotBotContact(contact)
    );
    
    console.log('[Dashboard] Telegram contacts filtering:', {
      rawCount: rawTelegramContacts.length,
      filteredCount: filteredTelegramContacts.length,
      rawContacts: rawTelegramContacts.map(c => ({ 
        id: c.id, 
        name: c.display_name || c.name, 
        platform: c.platform,
        telegram_id: c.telegram_id 
      })),
      filteredContacts: filteredTelegramContacts.map(c => ({ 
        id: c.id, 
        name: c.display_name || c.name 
      }))
    });
    
    return filteredTelegramContacts.map((contact: any) => ({
      id: contact.id,
      display_name: contact.display_name || contact.name || 'Unknown Contact',
      avatar_url: contact.avatar_url,
      last_message: contact.last_message,
      last_message_at: contact.last_message_at,
      telegram_id: contact.telegram_id,
      platform: 'telegram' as const
    }));
  }, [allContacts]);

  // Fetch contacts for active platforms with caching
  const fetchContactsForPlatform = (platform: 'whatsapp' | 'telegram') => {
    if (!currentUser?.id) return;
    
    if (!canFetch(platform)) {
      console.log(`[Dashboard] Skipping ${platform} fetch due to cooldown`);
      return;
    }
    
    console.log(`[Dashboard] Fetching ${platform} contacts for user:`, currentUser.id);
    updateFetchTime(platform);
    dispatch(fetchContacts({ 
      userId: currentUser.id, 
      platform 
    }) as any);
  };

  // Fresh sync contacts for active platforms - CONTROLLED REFRESH
  const refreshContacts = () => {
    if (!currentUser?.id) return;
    
    console.log('[Dashboard] Refreshing contacts with controlled sync');
    
    // Reset fetch times to allow immediate refresh
    setLastFetchTime({});
    
    // Always try to fetch both platforms if they're connected
    if (platformConnection.whatsappConnected) {
      console.log('[Dashboard] Refreshing WhatsApp contacts');
      updateFetchTime('whatsapp');
      dispatch(freshSyncContacts({ 
        userId: currentUser.id, 
        platform: 'whatsapp' 
      }) as any);
    }
    
    if (platformConnection.telegramConnected) {
      console.log('[Dashboard] Refreshing Telegram contacts');
      updateFetchTime('telegram');
      dispatch(freshSyncContacts({ 
        userId: currentUser.id, 
        platform: 'telegram' 
      }) as any);
    }
    
    // If no platforms connected, still try to fetch with cooldown
    if (!platformConnection.whatsappConnected && !platformConnection.telegramConnected) {
      console.log('[Dashboard] No platforms connected, trying conservative fetch');
      setTimeout(() => {
        fetchContactsForPlatform('whatsapp');
        setTimeout(() => {
          fetchContactsForPlatform('telegram');
        }, 1000);
      }, 500);
    }
  };

  // IMMEDIATE FETCH ON MOUNT - Don't wait for platform connection
  useEffect(() => {
    if (currentUser?.id) {
      console.log('[Dashboard] Component mounted, checking if fetch needed');
      // Only fetch if we can (respecting cooldown)
      if (canFetch('whatsapp')) {
        fetchContactsForPlatform('whatsapp');
      }
      if (canFetch('telegram')) {
        // Small delay to prevent simultaneous requests
        setTimeout(() => {
          fetchContactsForPlatform('telegram');
        }, 500);
      }
    }
  }, [currentUser?.id]);

  // Auto-fetch when platform connections are established (with cooldown)
  useEffect(() => {
    if (currentUser?.id && platformConnection.whatsappConnected && canFetch('whatsapp')) {
      console.log('[Dashboard] WhatsApp connected, fetching contacts');
      fetchContactsForPlatform('whatsapp');
    }
  }, [currentUser?.id, platformConnection.whatsappConnected]);

  useEffect(() => {
    if (currentUser?.id && platformConnection.telegramConnected && canFetch('telegram')) {
      console.log('[Dashboard] Telegram connected, fetching contacts');
      fetchContactsForPlatform('telegram');
    }
  }, [currentUser?.id, platformConnection.telegramConnected]);

  // Listen for platform connection changes to refresh contacts (with controlled refresh)
  useEffect(() => {
    const handlePlatformConnectionChange = () => {
      if (currentUser?.id) {
        console.log('[Dashboard] Platform connection changed, checking if refresh needed');
        // Small delay to ensure connection status is updated, then check cooldown
        setTimeout(() => {
          if (platformConnection.whatsappConnected && canFetch('whatsapp')) {
            fetchContactsForPlatform('whatsapp');
          }
          if (platformConnection.telegramConnected && canFetch('telegram')) {
            fetchContactsForPlatform('telegram');
          }
        }, 1000);
      }
    };

    const handleForceRefresh = (event: CustomEvent) => {
      if (currentUser?.id) {
        console.log('[Dashboard] Force refresh requested from platform switcher');
        // Force refresh bypasses cooldown
        refreshContacts();
      }
    };

    window.addEventListener('platform-connection-changed', handlePlatformConnectionChange);
    window.addEventListener('force-refresh-contacts', handleForceRefresh as EventListener);
    return () => {
      window.removeEventListener('platform-connection-changed', handlePlatformConnectionChange);
      window.removeEventListener('force-refresh-contacts', handleForceRefresh as EventListener);
    };
  }, [currentUser?.id, platformConnection]);

  return {
    whatsappContacts,
    telegramContacts,
    isLoadingWhatsApp: isLoading && platformConnection.whatsappConnected,
    isLoadingTelegram: isLoading && platformConnection.telegramConnected,
    errorWhatsApp: platformConnection.whatsappConnected ? error : null,
    errorTelegram: platformConnection.telegramConnected ? error : null,
    refreshContacts,
    totalContacts: whatsappContacts.length + telegramContacts.length,
    isLoading: isLoading
  };
};

const ActiveContactsList = ({ contactsState }: { contactsState: ReturnType<typeof useReduxContacts> }) => {
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const platformConnection = usePlatformConnection();

  // FIXED: Clarify activity definition and fix contradictory messages - Fix for issue C
  const allContacts = useMemo(() => {
    return [...contactsState.whatsappContacts, ...contactsState.telegramContacts]
      .filter(contact => {
        // Activity is defined as: contacts with recent messages (last_message_at exists)
        // OR contacts with any message content (last_message exists)
        return contact.last_message_at || contact.last_message;
      })
      .sort((a, b) => {
        // Sort by last message time, most recent first
        const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return timeB - timeA;
      })
      .slice(0, 8); // Top 8 most recent
  }, [contactsState.whatsappContacts, contactsState.telegramContacts]);

  const filteredContacts = useMemo(() => {
    if (selectedPlatform === 'all') return allContacts;
    return allContacts.filter(contact => contact.platform === selectedPlatform);
  }, [allContacts, selectedPlatform]);

  // FIXED: Calculate consistent contact counts
  const totalActiveContacts = allContacts.length;
  const totalAllContacts = contactsState.whatsappContacts.length + contactsState.telegramContacts.length;

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'whatsapp': return <FaWhatsapp className="h-4 w-4 text-green-500" />;
      case 'telegram': return <FaTelegram className="h-4 w-4 text-blue-500" />;
      default: return null;
    }
  };

  if (contactsState.isLoading) {
    return (
      <Card className='whatsapp-glowing-border'>
        <CardHeader>
          <CardTitle>Active Contacts</CardTitle>
          <CardDescription>Loading contact activity...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center space-x-4">
                <div className="h-10 w-10 bg-muted animate-pulse rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
                </div>
                <div className="h-4 w-16 bg-muted animate-pulse rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (contactsState.errorWhatsApp || contactsState.errorTelegram) {
    return (
      <Card className='whatsapp-glowing-border'>
        <CardHeader>
          <CardTitle>Active Contacts</CardTitle>
          <CardDescription>Error loading contacts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Failed to load contacts</p>
            <Button onClick={contactsState.refreshContacts} className="mt-4" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className='whatsapp-glowing-border'>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Active Contacts</CardTitle>
            <CardDescription>
              Contacts with recent message activity ({totalActiveContacts} active of {totalAllContacts} total)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={contactsState.refreshContacts}
              variant="outline"
              size="sm"
              disabled={contactsState.isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${contactsState.isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="telegram">Telegram</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {filteredContacts.length === 0 ? (
            <div className="text-center py-8 space-y-4">
              <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <div>
                <p className="text-muted-foreground font-medium">No active contacts found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {totalAllContacts > 0 
                    ? `${totalAllContacts} total contacts loaded, but none have recent message activity`
                    : 'No contacts loaded yet'
                  }
                </p>
                <p className="text-sm text-muted-foreground">
                  WhatsApp: {platformConnection.whatsappConnected ? 'Connected' : 'Disconnected'} • 
                  Telegram: {platformConnection.telegramConnected ? 'Connected' : 'Disconnected'}
                </p>
              </div>
              <div className="space-y-2">
                <Button 
                  onClick={contactsState.refreshContacts}
                  disabled={contactsState.isLoading}
                  className="gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${contactsState.isLoading ? 'animate-spin' : ''}`} />
                  {contactsState.isLoading ? 'Refreshing...' : 'Refresh & Fetch Contacts'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Activity is based on contacts with recent messages or last message timestamps
                </p>
              </div>
            </div>
          ) : (
            filteredContacts.map((contact, index) => (
              <div key={`${contact.platform}-${contact.id}`}>
                <div className="flex items-center space-x-4">
                  <div className="relative">
                    <Avatar>
                      <AvatarImage src={contact.avatar_url} />
                      <AvatarFallback>
                        {contact.display_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <p className="text-sm font-medium truncate">{contact.display_name}</p>
                      {getPlatformIcon(contact.platform)}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {contact.last_message || 'No recent messages'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Active</p>
                    <p className="text-xs text-muted-foreground">
                      {contact.last_message_at 
                        ? new Date(contact.last_message_at).toLocaleDateString()
                        : 'Recently'
                      }
                    </p>
                  </div>
                </div>
                {index < filteredContacts.length - 1 && <Separator className="mt-4" />}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const DailyNotesSection = ({ contactsState }: { contactsState: ReturnType<typeof useReduxContacts> }) => {
  const navigate = useNavigate();
  const [selectedWhatsAppContact, setSelectedWhatsAppContact] = useState<Contact | null>(null);
  const [selectedTelegramContact, setSelectedTelegramContact] = useState<Contact | null>(null);
  const [dailySummary, setDailySummary] = useState<any>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const currentUser = useSelector((state: any) => state.auth.session?.user);
  const platformConnection = usePlatformConnection();

  // Get contacts with messages only - FIXED: Show ALL contacts, not just those with messages
  const whatsappContactsWithMessages = contactsState.whatsappContacts; // Show ALL WhatsApp contacts
  const telegramContactsWithMessages = contactsState.telegramContacts; // Show ALL Telegram contacts

  // FIXED: Use multiple sources to determine platform connection status - Fix for issue A
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);
  
  useEffect(() => {
    const updateConnectedPlatforms = async () => {
      try {
        // Primary: Use platformConnection hook
        const primaryPlatforms = [];
        if (platformConnection.whatsappConnected) primaryPlatforms.push('whatsapp');
        if (platformConnection.telegramConnected) primaryPlatforms.push('telegram');
        
        // Secondary: Use localStorage check as fallback
        const whatsappInStorage = currentUser?.id ? isWhatsAppConnected(currentUser.id) : false;
        const telegramInStorage = currentUser?.id ? isTelegramConnected(currentUser.id) : false;
        
        // Combine both sources
        const combinedPlatforms = [];
        if (platformConnection.whatsappConnected || whatsappInStorage) combinedPlatforms.push('whatsapp');
        if (platformConnection.telegramConnected || telegramInStorage) combinedPlatforms.push('telegram');
        
        // Tertiary: Check if we have actual contacts as another indicator
        const hasWhatsappContacts = contactsState.whatsappContacts.length > 0;
        const hasTelegramContacts = contactsState.telegramContacts.length > 0;
        
        if (hasWhatsappContacts && !combinedPlatforms.includes('whatsapp')) {
          combinedPlatforms.push('whatsapp');
        }
        if (hasTelegramContacts && !combinedPlatforms.includes('telegram')) {
          combinedPlatforms.push('telegram');
        }
        
        setConnectedPlatforms(combinedPlatforms);
        logger.info('[Dashboard] Updated connected platforms using multiple sources:', {
          primary: primaryPlatforms,
          storage: { whatsapp: whatsappInStorage, telegram: telegramInStorage },
          contacts: { whatsapp: hasWhatsappContacts, telegram: hasTelegramContacts },
          final: combinedPlatforms
        });
      } catch (error) {
        logger.error('[Dashboard] Error updating connected platforms:', error);
        // Ultimate fallback: just use platformConnection hook
        const fallbackPlatforms = [];
        if (platformConnection.whatsappConnected) fallbackPlatforms.push('whatsapp');
        if (platformConnection.telegramConnected) fallbackPlatforms.push('telegram');
        setConnectedPlatforms(fallbackPlatforms);
      }
    };

    updateConnectedPlatforms();

    // Listen for platform connection changes
    const handlePlatformConnectionChange = () => {
      logger.info('[Dashboard] Platform connection changed, updating connected platforms');
      updateConnectedPlatforms();
    };

    window.addEventListener('platform-connection-changed', handlePlatformConnectionChange);
    window.addEventListener('refresh-platform-status', handlePlatformConnectionChange);
    
    return () => {
      window.removeEventListener('platform-connection-changed', handlePlatformConnectionChange);
      window.removeEventListener('refresh-platform-status', handlePlatformConnectionChange);
    };
  }, [platformConnection.whatsappConnected, platformConnection.telegramConnected, contactsState.whatsappContacts.length, contactsState.telegramContacts.length, currentUser?.id]);

  // Debug logging - but don't show to user
  console.log('[Dashboard] Contact counts:', {
    whatsappTotal: contactsState.whatsappContacts.length,
    telegramTotal: contactsState.telegramContacts.length,
    whatsappFiltered: whatsappContactsWithMessages.length,
    telegramFiltered: telegramContactsWithMessages.length,
    connectedPlatforms,
    whatsappConnected: connectedPlatforms.includes('whatsapp'),
    telegramConnected: connectedPlatforms.includes('telegram')
  });

  const fetchDailySummary = async (contactId: string, platform: 'whatsapp' | 'telegram') => {
    if (!currentUser?.id || !contactId) return;

    setIsLoadingSummary(true);
    setSummaryError(null);

    try {
      const response = await api.get(`/analytics/summary/${currentUser.id}/${contactId}?platform=${platform}`);

      if (response.data) {
        setDailySummary(response.data);
      } else {
        setSummaryError('No daily summary available for this contact');
        setDailySummary(null);
      }
    } catch (error) {
      console.error('Error fetching daily summary:', error);
      setSummaryError('Failed to fetch daily summary');
      setDailySummary(null);
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const handleWhatsAppContactSelect = (contact: Contact | null) => {
    setSelectedWhatsAppContact(contact);
    setSelectedTelegramContact(null);
    if (contact) {
      fetchDailySummary(contact.id, 'whatsapp');
    } else {
      setDailySummary(null);
    }
  };

  const handleTelegramContactSelect = (contact: Contact | null) => {
    setSelectedTelegramContact(contact);
    setSelectedWhatsAppContact(null);
    if (contact) {
      fetchDailySummary(contact.id, 'telegram');
    } else {
      setDailySummary(null);
    }
  };

  const handleOpenConversation = (contact: Contact, platform: 'whatsapp' | 'telegram') => {
    if (!contact) return;
    
    localStorage.setItem('dailyfix_active_platform', platform);
    
    navigate('/dashboard', { 
      state: { 
        view: 'inbox',
        platform: platform,
        selectedContactId: contact.id,
        selectedContact: contact
      }
    });
  };

  // Determine which contact is selected and which platform
  const selectedContact = selectedWhatsAppContact || selectedTelegramContact;
  const selectedPlatform = selectedWhatsAppContact ? 'whatsapp' : 'telegram';

  // Check if we have any connected platforms
  const hasConnectedPlatforms = connectedPlatforms.length > 0;
  const whatsappConnected = connectedPlatforms.includes('whatsapp');
  const telegramConnected = connectedPlatforms.includes('telegram');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          Daily Notes & AI Summary
        </CardTitle>
        <CardDescription>
          {hasConnectedPlatforms 
            ? "Select a contact to generate AI-powered conversation insights"
            : "Connect to a platform to start generating daily summaries"
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasConnectedPlatforms ? (
          // No platforms connected - show connection prompt
          <div className="text-center py-8 space-y-4">
            <div className="p-4 rounded-full bg-gray-100 dark:bg-gray-800 w-16 h-16 mx-auto flex items-center justify-center">
              <MessageCircle className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-medium mb-2">No Platforms Connected</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Connect to WhatsApp or Telegram to start generating daily conversation summaries
              </p>
              <Button onClick={() => navigate('/settings')} className="gap-2">
                <Settings className="h-4 w-4" />
                Go to Settings
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* WhatsApp Contacts Dropdown - Only show if WhatsApp is connected */}
            {whatsappConnected && (
              <div>
                <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                  <FaWhatsapp className="h-4 w-4 text-green-500" />
                  WhatsApp Contacts ({whatsappContactsWithMessages.length})
                </label>
                {whatsappContactsWithMessages.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-4 border rounded">
                    No WhatsApp contacts available. Try refreshing your contacts.
                  </div>
                ) : (
                  <Select onValueChange={(value) => {
                    if (value === 'none') {
                      handleWhatsAppContactSelect(null);
                    } else {
                      const contact = whatsappContactsWithMessages.find(c => c.id === value);
                      if (contact) handleWhatsAppContactSelect(contact);
                    }
                  }}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={
                        selectedWhatsAppContact 
                          ? selectedWhatsAppContact.display_name 
                          : "Choose a WhatsApp contact"
                      } />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px] overflow-y-auto">
                      <SelectItem value="none">
                        <span className="text-muted-foreground">None</span>
                      </SelectItem>
                      {whatsappContactsWithMessages.map((contact) => (
                        <SelectItem key={contact.id} value={contact.id}>
                          <div className="flex items-center gap-2 w-full">
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={contact.avatar_url} />
                              <AvatarFallback className="text-xs">
                                {contact.display_name.substring(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate text-sm">{contact.display_name}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {contact.last_message || 'No recent messages'}
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Telegram Contacts Dropdown - Only show if Telegram is connected */}
            {telegramConnected && (
              <div>
                <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                  <FaTelegram className="h-4 w-4 text-blue-500" />
                  Telegram Contacts ({telegramContactsWithMessages.length})
                </label>
                {telegramContactsWithMessages.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-4 border rounded">
                    No Telegram contacts available. Try refreshing your contacts.
                  </div>
                ) : (
                  <Select onValueChange={(value) => {
                    if (value === 'none') {
                      handleTelegramContactSelect(null);
                    } else {
                      const contact = telegramContactsWithMessages.find(c => c.id === value);
                      if (contact) handleTelegramContactSelect(contact);
                    }
                  }}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={
                        selectedTelegramContact 
                          ? selectedTelegramContact.display_name 
                          : "Choose a Telegram contact"
                      } />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px] overflow-y-auto">
                      <SelectItem value="none">
                        <span className="text-muted-foreground">None</span>
                      </SelectItem>
                      {telegramContactsWithMessages.map((contact) => (
                        <SelectItem key={contact.id} value={contact.id}>
                          <div className="flex items-center gap-2 w-full">
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={contact.avatar_url} />
                              <AvatarFallback className="text-xs">
                                {contact.display_name.substring(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate text-sm">{contact.display_name}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {contact.last_message || 'No recent messages'}
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* No Contacts Message - Only show if platforms are connected but no contacts */}
            {hasConnectedPlatforms && 
             !contactsState.isLoading && 
             whatsappContactsWithMessages.length === 0 && 
             telegramContactsWithMessages.length === 0 && (
              <div className="text-center py-8 space-y-4">
                <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <div>
                  <p className="text-muted-foreground font-medium">No contacts found</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connected platforms: {connectedPlatforms.join(', ')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Button 
                    onClick={contactsState.refreshContacts}
                    disabled={contactsState.isLoading}
                    className="gap-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${contactsState.isLoading ? 'animate-spin' : ''}`} />
                    {contactsState.isLoading ? 'Refreshing...' : 'Refresh & Fetch Contacts'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Click refresh to fetch contacts from connected platforms
                  </p>
                </div>
              </div>
            )}
            
            {/* Daily Summary Content */}
            {selectedContact && (
              <>
                <Separator />
                
                <div className="space-y-4">
                  {/* Contact Info Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={selectedContact.avatar_url} />
                        <AvatarFallback>
                          {selectedContact.display_name.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h4 className="font-medium">{selectedContact.display_name}</h4>
                        <div className="flex items-center gap-2">
                          {selectedPlatform === 'whatsapp' ? (
                            <FaWhatsapp className="h-3 w-3 text-green-500" />
                          ) : (
                            <FaTelegram className="h-3 w-3 text-blue-500" />
                          )}
                          <span className="text-sm text-muted-foreground capitalize">
                            {selectedPlatform}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <Button
                      onClick={() => handleOpenConversation(selectedContact, selectedPlatform as 'whatsapp' | 'telegram')}
                      size="sm"
                      className="gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open Conversation
                    </Button>
                  </div>
                  
                  {/* AI Summary */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">AI Summary</h4>
                    
                    {isLoadingSummary ? (
                      <div className="flex items-center space-x-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">Generating AI summary...</span>
                      </div>
                    ) : summaryError ? (
                      <p className="text-sm text-muted-foreground text-red-500">{summaryError}</p>
                    ) : dailySummary ? (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {dailySummary.summary}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Generated: {new Date(dailySummary.generated_at).toLocaleString()}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Select a contact to view AI-generated daily summary
                      </p>
                    )}
                  </div>
                  
                  <Separator />
                  
                  <div>
                    <h4 className="text-sm font-medium mb-2">Key Features</h4>
                    <ul className="space-y-1">
                      {[
                        'Real-time contact fetching',
                        'AI-powered conversation analysis',
                        'Daily activity summaries',
                        'Contact engagement insights'
                      ].map((point, index) => (
                        <li key={index} className="text-sm text-muted-foreground flex items-center space-x-2">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button 
          variant="outline" 
          className="flex-1"
          disabled={!selectedContact}
          onClick={() => selectedContact && fetchDailySummary(selectedContact.id, selectedPlatform as 'whatsapp' | 'telegram')}
        >
          <MessageCircle className="h-4 w-4 mr-2" />
          {selectedContact ? 'Refresh Summary' : 'Select Contact First'}
        </Button>
        
        {selectedContact && (
          <Button 
            onClick={() => handleOpenConversation(selectedContact, selectedPlatform as 'whatsapp' | 'telegram')}
            className="gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            Open Chat
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

const Dashboard = () => {
  // Use our hooks
  const platformConnection = usePlatformConnection();
  const analyticsData = useAnalyticsData();
  const contactsState = useReduxContacts();

  // FIXED: Manual refresh function without full page reload - Fix for issue D
  const handleRefresh = () => {
    // Refresh contacts
    contactsState.refreshContacts();
    // Refresh analytics data with cache bypass
    if ('refresh' in analyticsData) {
      (analyticsData as any).refresh();
    }
    // Show toast to confirm refresh
    import('react-hot-toast').then(({ toast }) => {
      toast.success('Dashboard data refreshed');
    });
  };

  // Show empty state if no platforms are connected
  if (!platformConnection.isLoading && platformConnection.totalConnected === 0) {
    return <EmptyDashboardState />;
  }

  // Show error state if there are critical errors
  if (analyticsData.error && !analyticsData.stats) {
    return (
      <div className="flex-1 h-full overflow-y-auto">
        <div className="space-y-8 p-8 pb-16 max-w-7xl mx-auto">
          <div className="text-center py-12">
            <Activity className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Dashboard Temporarily Unavailable</h2>
            <p className="text-muted-foreground mb-4">
              We're having trouble loading your analytics data. Please try again.
            </p>
            <Button onClick={handleRefresh}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full overflow-y-auto">
      <div className="space-y-4 md:space-y-8 p-4 md:p-8 pb-8 md:pb-16 max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1 md:space-y-2">
            <h1 className="text-xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground text-sm md:text-lg">
              Real-time overview of your messaging platforms and activity
            </p>
            {analyticsData.lastUpdated && (
              <p className="text-xs text-muted-foreground">
                Last updated: {analyticsData.lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </div>
          <Button 
            onClick={handleRefresh} 
            variant="outline"
            className="gap-2 w-full md:w-auto"
            disabled={analyticsData.isLoading || contactsState.isLoading}
          >
            {(analyticsData.isLoading || contactsState.isLoading) ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
        
        {/* Platform Statistics Cards */}
        <div className="space-y-3 md:space-y-4">
          <h2 className="text-lg md:text-xl font-semibold">Platform Statistics</h2>
          <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3 xl:grid-cols-4">
            <div className="lg:col-span-2 xl:col-span-3">
              <PlatformStatsCards analyticsData={analyticsData} />
            </div>
            <div className="lg:col-span-1 xl:col-span-1 whatsapp-glowing-border">
              <PriorityStatsCard />
            </div>
          </div>
        </div>
        
        {/* Platform Overview */}
        <div className="space-y-3 md:space-y-4">
          <h2 className="text-lg md:text-xl font-semibold">Platform Overview</h2>
          <PlatformOverview analyticsData={analyticsData} />
        </div>
        
        {/* Active Contacts and Daily Notes */}
        <div className="space-y-3 md:space-y-4">
          <h2 className="text-lg md:text-xl font-semibold">Activity & Insights</h2>
          <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
            <ActiveContactsList contactsState={contactsState} />
            <DailyNotesSection contactsState={contactsState} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard; 