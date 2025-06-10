import React, { useEffect, useCallback, useState, memo, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import PropTypes from 'prop-types';
import { toast } from 'react-hot-toast';
import { fetchContacts, selectContactPriority, updateContactMembership, freshSyncContacts, addContact, hideContact, updateContactDisplayName } from '@/store/slices/contactSlice';
import logger from '@/utils/logger';
import { SYNC_STATES } from '@/utils/syncUtils';
import { getSocket, initializeSocket } from '@/utils/socket';
import { format } from 'date-fns';
import api from '@/utils/api';
import { BiSolidHide } from "react-icons/bi";
import { MdCloudSync } from "react-icons/md";
import { FiEdit3, FiRefreshCw, FiSearch, FiX, FiMessageSquare } from "react-icons/fi";
import useAvatarCache from '@/hooks/useAvatarCache';
import '@/components/styles/ShakeAnimation.css';
import platformManager from '@/services/PlatformManager';
import ErrorMessage from '@/components/ui/ErrorMessage';

// Import shadcn UI components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

// Update the ShimmerContactList component with more visible styling
const ShimmerContactList = () => (
  <div className="space-y-4 p-4 bg-[#ECE5DD] h-full min-h-[300px]">
    {[1, 2, 3, 4, 5, 6, 7].map((i) => (
      <div key={i} className="flex items-center space-x-4 p-3 bg-white/60 rounded-md animate-pulse">
        <Skeleton className="h-12 w-12 rounded-full bg-gray-300" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-5 w-3/4 bg-gray-300" />
          <Skeleton className="h-4 w-1/2 bg-gray-300" />
        </div>
      </div>
    ))}
  </div>
);

// Component for showing priority
const PriorityBubble = ({ priority }) => {
  if (!priority) return null;
  
  const getColorClass = () => {
    switch (priority) {
      case 'high':
        return 'bg-red-500';
      case 'medium':
        return 'bg-yellow-500';
      case 'low':
        return 'bg-green-500';
      default:
        return 'bg-gray-400';
    }
  };
  
  return (
    <Badge 
      variant="default" 
      className={`absolute left-1 top-1 size-2 rounded-full ${getColorClass()}`}
    />
  );
};

// Contact Avatar component
const ContactAvatar = ({ contact, size = 40 }) => {
  const avatarUrl = contact.avatar_url || null;
  const displayName = contact.display_name || 'Unknown';
  const initials = displayName.substring(0, 2).toUpperCase();
  
  return (
    <Avatar className={`h-${size / 4} w-${size / 4}`}>
      {avatarUrl ? (
        <AvatarImage src={avatarUrl} alt={displayName} />
      ) : null}
      <AvatarFallback className="bg-[#757575] text-white">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
};

// Contact item component using shadcn components
const ContactItem = memo(({ contact, onClick, isSelected }: { contact: any, onClick: Function, isSelected: any }) => {
  const dispatch = useDispatch();
  const priority = useSelector(state => selectContactPriority(state, contact.id));
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(contact.display_name);
  const [showTooltip, setShowTooltip] = useState(false);
  const editInputRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (isEditing && editInputRef.current && !editInputRef.current.contains(e.target)) {
        setIsEditing(false);
        setEditedName(contact.display_name);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEditing, contact.display_name]);

  const handleEdit = (e) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    dispatch(hideContact(contact.id));
  };

  const handleNameSubmit = (e) => {
    if (e.key === 'Enter' && editedName.trim()) {
      dispatch(updateContactDisplayName({ contactId: contact.id, displayName: editedName.trim() }));
      setIsEditing(false);
    }
  };

  return (
    <div
      className={`relative flex items-center px-4 py-3 cursor-pointer hover:bg-gray-100 ${
        isSelected ? 'bg-gray-200' : ''
      }`}
      onClick={onClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <PriorityBubble priority={priority} />

      {showTooltip && (
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-2 bg-[#1a1b26] p-1 rounded shadow-lg z-10">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleEdit}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 p-0 text-gray-400 hover:text-white"
                >
                  <FiEdit3 size={20} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Edit contact name</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleDelete}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 p-0 text-neutral-800 bg-gradient-to-r from-[#61FD7D] to-[#25CF43] hover:text-white/70 hover:bg-neutral-900"
                >
                  <BiSolidHide size={20} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Hide contact</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      <ContactAvatar contact={contact} size={40} />
      
      <div className="ml-3 flex-1 min-w-0">
        <div className="flex justify-between items-start">
          {isEditing ? (
            <Input
              ref={editInputRef}
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={handleNameSubmit}
              className="bg-white text-black px-2 py-1 rounded w-full border border-gray-300"
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <h3 className="text-black font-semibold text-base truncate">
              {contact.display_name}
            </h3>
          )}
          {contact.last_message_at && !isEditing && (
            <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
              {format(new Date(contact.last_message_at), 'HH:mm')}
            </span>
          )}
        </div>
        {contact.last_message && !isEditing && (
          <p className="text-sm text-black truncate">
            {contact.last_message}
          </p>
        )}
      </div>
    </div>
  );
});

// Add a "Connect WhatsApp" component
const WhatsAppNotConnected = () => {
  const navigate = useNavigate();

  return (
    <Card className="h-full w-full border-none shadow-none bg-[#ECE5DD]/10">
      <CardContent className="flex flex-col items-center justify-center h-full py-10">
        <div className="p-4 rounded-full bg-gray-800 mb-4">
          <FiMessageSquare className="w-8 h-8 text-green-500" />
        </div>
        <CardTitle className="text-xl mb-2">WhatsApp Not Connected</CardTitle>
        <CardDescription className="text-center mb-6 max-w-md">
          You need to connect your WhatsApp account to view your contacts and messages.
        </CardDescription>
        <Button 
          onClick={() => navigate('/settings')}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          Connect WhatsApp
        </Button>
      </CardContent>
    </Card>
  );
};

// Add a "No Platforms Connected" component
const NoPlatformsConnected = () => {
  const navigate = useNavigate();

  return (
    <Card className="h-full w-full border-none shadow-none bg-neutral-900/10">
      <CardContent className="flex flex-col items-center justify-center h-full py-10">
        <div className="p-4 rounded-full bg-gray-800 mb-4">
          <FiMessageSquare className="w-8 h-8 text-blue-500" />
        </div>
        <CardTitle className="text-xl mb-2">No Platforms Connected</CardTitle>
        <CardDescription className="text-center mb-6 max-w-md">
          You need to connect to any messaging platform in Settings to view your inbox.
        </CardDescription>
        <Button 
          onClick={() => navigate('/settings')}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          Go to Settings
        </Button>
      </CardContent>
    </Card>
  );
};

const WhatsAppContactList = ({ onContactSelect, selectedContactId }) => {
  const contacts = useSelector((state) => state.contacts.items);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const session = useSelector(state => state.auth.session);
  const loading = useSelector((state) => state.contacts.loading);
  const error = useSelector((state) => state.contacts.error);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastManualRefreshTime, setLastManualRefreshTime] = useState(0);
  const [syncProgress, setSyncProgress] = useState(null);
  const [showAcknowledgment, setShowAcknowledgment] = useState(false);
  const [hasShownAcknowledgment, setHasShownAcknowledgment] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // syncRequestId is used in the refreshContacts function
  const [syncRequestId, setSyncRequestId] = useState(null);
  const [refreshCooldown, setRefreshCooldown] = useState(false);
  const [refreshTooltip, setRefreshTooltip] = useState('');
  const refreshButtonRef = useRef(null);
  const syncStatusPollingRef = useRef(null);

  const loadContactsWithRetry = useCallback(async (retryCount = 0) => {
    try {
      if (!session?.user?.id) {
        logger.warn('[WhatsAppContactList] No valid user ID in session, cannot fetch contacts');
        return;
      }
      
      // Log active platform for debugging
      const activePlatform = localStorage.getItem('dailyfix_active_platform');
      logger.info(`[WhatsAppContactList] Active platform in localStorage: ${activePlatform}`);
      
      logger.info('[WhatsAppContactList] Fetching contacts...');
      const result = await dispatch(fetchContacts({
        userId: session.user.id,
        platform: 'whatsapp'
      })).unwrap();
      logger.info('[Contacts fetch log from component] result: ', result);

      if (result?.inProgress) {
        logger.info('[WhatsAppContactList] Sync in progress, showing sync state');
        setSyncProgress({
          state: SYNC_STATES.SYNCING,
          message: 'Syncing contacts...'
        });
        return;
      }

      // if (result?.contacts?.length === 0 && !syncProgress) {
      //   logger.info('[WhatsAppContactList] No contacts found, initiating sync');
      //   if (session?.user?.id) {
      //     await dispatch(syncContact(session.user.id)).unwrap();
      //   }
      // }
    } catch (err) {
      logger.error('[WhatsAppContactList] Error fetching contacts:', err);
      if (retryCount < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
        logger.info(`[WhatsAppContactList] Retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        setTimeout(() => {
          loadContactsWithRetry(retryCount + 1);
        }, delay);
      } else {
        // toast.error('Failed to load contacts after multiple attempts');
      }
    }
  }, [dispatch, syncProgress, session, navigate]);

  const handleRefresh = async () => {
    // Check if we're in cooldown period
    if (refreshCooldown) {
      // IMPROVED: More engaging messages when clicking refresh multiple times
      const messages = [
        'Whoa there! Still refreshing, give it a moment...',
        'Patience, young padawan. Contacts are still syncing...',
        'Hold your horses! Sync in progress...',
        "I'm working as fast as I can! Still syncing...",
        "Rome wasn't built in a day, and neither is your contact list. Still syncing...",
      ];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      setRefreshTooltip(randomMessage);

      // Shake the button to provide visual feedback
      if (refreshButtonRef.current) {
        refreshButtonRef.current.classList.add('shake-animation');
        setTimeout(() => {
          refreshButtonRef.current?.classList.remove('shake-animation');
        }, 500);
      }
      return;
    }

    // Check if we've refreshed recently (within 3 seconds)
    const now = Date.now();
    if (now - lastManualRefreshTime < 3000) {
      toast.info('Please wait a moment before refreshing again');
      return;
    }

    // CRITICAL FIX: Set a timeout to ensure we don't get stuck
    const syncTimeout = setTimeout(() => {
      if (syncProgress && syncProgress.state === SYNC_STATES.SYNCING) {
        logger.warn('[WhatsAppContactList] Sync timeout reached, forcing completion');
        setRefreshCooldown(false);
        setIsRefreshing(false);
        setSyncProgress({
          state: SYNC_STATES.COMPLETED,
          message: 'Sync timed out, showing available contacts',
          progress: 100
        });
        if (session?.user?.id) {
          dispatch(fetchContacts({
            userId: session.user.id,
            platform: 'whatsapp'
          }));
        }
      }
    }, 60000); // 1 minute timeout

    try {
      setIsRefreshing(true);
      setRefreshCooldown(true);
      setLastManualRefreshTime(now);

      setSyncProgress({
        state: SYNC_STATES.SYNCING,
        message: 'Starting fresh sync...',
        progress: 0
      });

      if (!session?.user?.id) {
        throw new Error('No valid user ID in session');
      }

      const result = await dispatch(freshSyncContacts({
        userId: session.user.id,
        platform: 'whatsapp'
      })).unwrap();

      // Check if we have a request ID to track
      if (result?.meta?.sync_info?.request_id) {
        setSyncRequestId(result.meta.sync_info.request_id);
      }

      // Check if sync is still in progress
      if (result?.meta?.sync_info?.is_syncing) {
        setSyncProgress({
          state: SYNC_STATES.SYNCING,
          message: 'Sync in progress...',
          progress: result?.meta?.sync_info?.progress || 10
        });

        // Start polling for sync status if we have a request ID
        if (result?.meta?.sync_info?.request_id) {
          pollSyncStatus(result.meta.sync_info.request_id);
        }

        toast.success('Contacts are being refreshed in the background');
      } else {
        // Sync completed immediately
        setSyncProgress({
          state: SYNC_STATES.COMPLETED,
          message: 'Sync completed successfully',
          progress: 100
        });
        toast.success(result?.message || 'Contacts refreshed successfully');

        // Reset cooldown after a short delay
        setTimeout(() => {
          setRefreshCooldown(false);
        }, 2000);

        // Clear the sync timeout
        clearTimeout(syncTimeout);
      }
    } catch (error) {
      const errorMsg = error?.message || String(error);
      let errorMessage = 'Failed to refresh contacts.';
      if (errorMsg.toLowerCase().includes('timeout')) {
        errorMessage = 'Fresh syncing stopped due to timeout';
      } else if (errorMsg.toLowerCase().includes('failed')) {
        errorMessage = errorMsg;
      }

      toast.error('Sync encountered an issue: ' + errorMessage);
      setSyncProgress({
        state: SYNC_STATES.ERROR,
        message: errorMessage,
        progress: 0
      });

      // Reset cooldown after error
      setRefreshCooldown(false);

      // Clear the sync timeout
      clearTimeout(syncTimeout);
    } finally {
      setIsRefreshing(false);

      // Clear tooltip after a delay
      setTimeout(() => {
        setRefreshTooltip('');
      }, 3000);
    }
  };

  // Function to poll sync status
  const pollSyncStatus = useCallback((requestId) => {
    if (!requestId) return;

    let pollCount = 0;
    const maxPolls = 15; // Maximum number of polls (15 * 2s = 30s)
    let consecutiveErrors = 0;
    let lastProgress = 0;
    let stuckCount = 0;

    const pollInterval = setInterval(async () => {
      try {
        pollCount++;

        // Store the interval reference
        syncStatusPollingRef.current = pollInterval;

        // Get sync status from API
        const response = await api.get(`/api/v1/whatsapp/syncStatus?requestId=${requestId}`);
        const statusData = response.data;

        logger.info('[WhatsAppContactList] Sync status poll:', {
          requestId,
          pollCount,
          status: statusData
        });

        // CRITICAL FIX: Check if progress is stuck
        if (statusData.progress === lastProgress) {
          stuckCount++;
        } else {
          stuckCount = 0;
          lastProgress = statusData.progress;
        }

        // If progress is stuck for too long (5 polls = 10 seconds), consider it completed
        if (stuckCount >= 5) {
          logger.warn('[WhatsAppContactList] Sync progress appears stuck, forcing completion');
          clearInterval(pollInterval);
          setRefreshCooldown(false);
          setSyncProgress({
            state: SYNC_STATES.COMPLETED,
            message: 'Sync completed (timeout)',
            progress: 100
          });

          // Fetch the updated contacts
          if (session?.user?.id) {
            dispatch(fetchContacts({
              userId: session.user.id,
              platform: 'whatsapp'
            }));
          }
          return;
        }

        // CRITICAL FIX: Double-check with /contacts endpoint if sync is really still in progress
        if (pollCount % 3 === 0 && statusData.is_syncing) {
          try {
            const contactsResponse = await api.get('/api/v1/whatsapp/contacts');
            const contactsData = contactsResponse.data;

            // If contacts endpoint says sync is complete but status endpoint disagrees,
            // trust the contacts endpoint
            if (contactsData?.meta?.sync_info &&
                !contactsData.meta.sync_info.is_syncing &&
                statusData.is_syncing) {
              logger.warn('[WhatsAppContactList] Sync status mismatch detected, forcing completion');
              clearInterval(pollInterval);
              setRefreshCooldown(false);
              setSyncProgress({
                state: SYNC_STATES.COMPLETED,
                message: 'Sync completed successfully',
                progress: 100
              });

              // Fetch the updated contacts
              if (session?.user?.id) {
                dispatch(fetchContacts({
                  userId: session.user.id,
                  platform: 'whatsapp'
                }));
              }
              return;
            }
          } catch (contactsError) {
            logger.error('[WhatsAppContactList] Error checking contacts endpoint:', contactsError);
          }
        }

        if (!statusData.is_syncing) {
          // Sync completed
          clearInterval(pollInterval);
          setRefreshCooldown(false);
          setSyncProgress({
            state: SYNC_STATES.COMPLETED,
            message: 'Sync completed successfully',
            progress: 100
          });

          // Fetch the updated contacts
          if (session?.user?.id) {
            dispatch(fetchContacts({
              userId: session.user.id,
              platform: 'whatsapp'
            }));
          }

          toast.success('Contacts refreshed successfully');
        } else {
          // Update progress
          setSyncProgress({
            state: SYNC_STATES.SYNCING,
            message: statusData.message || 'Sync in progress...',
            progress: statusData.progress || 50
          });
        }

        // Stop polling after max attempts
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          setRefreshCooldown(false);
          setSyncProgress({
            state: SYNC_STATES.COMPLETED,
            message: 'Sync completed (timeout)',
            progress: 100
          });

          // Fetch the updated contacts anyway
          if (session?.user?.id) {
            dispatch(fetchContacts({
              userId: session.user.id,
              platform: 'whatsapp'
            }));
          }
        }

        // Reset consecutive errors counter on success
        consecutiveErrors = 0;
      } catch (error) {
        logger.error('[WhatsAppContactList] Error polling sync status:', error);
        consecutiveErrors++;

        // If polling fails consistently, stop after fewer attempts
        if (consecutiveErrors >= 3 || pollCount > 5) {
          clearInterval(pollInterval);
          setRefreshCooldown(false);
          setSyncProgress({
            state: SYNC_STATES.COMPLETED,
            message: 'Sync status unknown, showing available contacts',
            progress: 100
          });

          // Fetch whatever contacts are available
          if (session?.user?.id) {
            dispatch(fetchContacts({
              userId: session.user.id,
              platform: 'whatsapp'
            }));
          }
        }
      }
    }, 2000); // Poll every 2 seconds

    // Safety cleanup after 2 minutes
    setTimeout(() => {
      if (syncStatusPollingRef.current === pollInterval) {
        clearInterval(pollInterval);
        logger.info('[WhatsAppContactList] Safety cleanup triggered for sync polling');
        setSyncProgress({
          state: SYNC_STATES.COMPLETED,
          message: 'Sync timed out',
          progress: 100
        });
      }
      if (refreshCooldown) {
        setRefreshCooldown(false);
        setSyncProgress({
          state: SYNC_STATES.COMPLETED,
          message: 'Sync status polling timed out',
          progress: 100
        });
      }
    }, 120000);
  }, [dispatch, refreshCooldown, session]);

  const handleContactSelect = useCallback(async (contact) => {
    try {
      logger.info('[WhatsAppContactList] Handling contact selection:', {
        contactId: contact.id,
        membership: contact?.membership,
        contact: contact
      });
      const tooltips = document.querySelectorAll('.tooltip');
      tooltips.forEach(t => t.remove());

      const membership = contact?.membership;
      switch (membership) {
        case 'invite':
          try {
            logger.info('[WhatsAppContactList] Auto-accepting invite for contact:', contact.id);
            const response = await api.post(`/api/v1/whatsapp/contacts/${contact.id}/accept`);
            if (response.data?.success) {
              logger.info('[WhatsAppContactList] Invite accepted successfully:', {
                contactId: contact.id,
                response: response.data
              });
              const updatedContact = response.data.contact || { ...contact, membership: 'join' };
              dispatch(updateContactMembership({ contactId: contact.id, updatedContact }));
              onContactSelect(updatedContact);
            } else if (response.data?.joinedBefore) {
              logger.info('[WhatsAppContactList] Contact was already joined:', contact.id);
              onContactSelect({ ...contact, membership: 'join' });
            } else {
              logger.warn('[WhatsAppContactList] Invite acceptance failed:', {
                contactId: contact.id,
                error: response.data?.message
              });
              onContactSelect({ ...contact });
            }
          } catch (error) {
            logger.error('[WhatsAppContactList] Error accepting invite:', {
              contactId: contact.id,
              error: error.message
            });
            onContactSelect({ ...contact });
          }
          break;
        case 'leave':
          toast.error('You have left this chat');
          return;
        case 'ban':
          toast.error('You are banned from this chat');
          return;
        case 'join':
          onContactSelect({ ...contact });
          break;
        case undefined:
          logger.warn('[WhatsAppContactList] Contact has no membership state:', contact);
          onContactSelect({ ...contact });
          break;
        default:
          logger.warn('[WhatsAppContactList] Unknown membership state:', membership);
          toast.error('Invalid membership status');
          return;
      }
    } catch (err) {
      logger.error('[WhatsAppContactList] Error handling contact selection:', err);
      toast.error('Failed to select contact');
    }
  }, [onContactSelect, dispatch]);

  // This function is used by child components via props
  const handleContactUpdate = useCallback((updatedContact) => {
    dispatch(updateContactMembership({ contactId: updatedContact.id, updatedContact }));
  }, [dispatch]);

  useEffect(() => {
    const socket = getSocket();
    const handleNewContact = (data) => {
      logger.info('[WhatsAppContactList] New contact received:', {
        contactId: data.id,
        displayName: data.display_name
      });
      dispatch(addContact(data));
      toast.success(`New contact: ${data.display_name}`);
    };
    if (socket) {
      socket.on('whatsapp:new_contact', handleNewContact);
      return () => socket.off('whatsapp:new_contact', handleNewContact);
    }
  }, [dispatch]);

  useEffect(() => {
    if (!session) {
      logger.warn('[WhatsAppContactList] No session found, redirecting to login');
      navigate('/login');
      return;
    }
    loadContactsWithRetry();
  }, [session, navigate, loadContactsWithRetry]);

  useEffect(() => {
    const initSocket = async () => {
      try {
        // Add explicit check for valid session before initializing socket
        if (!session?.access_token || !session?.user?.id) {
          logger.warn('[WhatsAppContactList] Cannot initialize socket - no valid session');
          return; // Exit early if no valid session
        }

        logger.info('[WhatsAppContactList] Initializing socket with session:', {
          hasToken: !!session?.access_token,
          userId: session?.user?.id
        });

        // Now attempt socket initialization with the validated session
        const socket = await initializeSocket({ platform: 'whatsapp' });

        if (!socket) {
          logger.error('[WhatsAppContactList] Failed to get socket instance');
          return;
        }

        const handleSyncProgress = (data) => {
          if (data.userId === session.user.id) {
            setSyncProgress({
              state: SYNC_STATES.SYNCING,
              progress: data.progress,
              message: data.details || 'Syncing contacts...'
            });
          }
        };

        const handleSyncComplete = (data) => {
          if (data.userId === session.user.id) {
            setSyncProgress(null);
            loadContactsWithRetry();
          }
        };

        const handleSyncError = (data) => {
          if (data.userId === session.user.id) {
            setSyncProgress({
              state: SYNC_STATES.ERROR,
              message: data.error || 'Sync failed'
            });
            toast.error('Contact sync failed: ' + (data.error || 'Unknown error'));
          }
        };

        socket.on('whatsapp:sync_progress', handleSyncProgress);
        socket.on('whatsapp:sync_complete', handleSyncComplete);
        socket.on('whatsapp:sync_error', handleSyncError);

        return () => {
          socket.off('whatsapp:sync_progress', handleSyncProgress);
          socket.off('whatsapp:sync_complete', handleSyncComplete);
          socket.off('whatsapp:sync_error', handleSyncError);
        };
      } catch (error) {
        logger.error('[WhatsAppContactList] Socket initialization error:', error);
      }
    };

    // Only attempt to initialize the socket if we have a session
    if (session?.access_token) {
      initSocket();
    } else {
      logger.warn('[WhatsAppContactList] Skipping socket initialization - no session available');
    }
  }, [session, loadContactsWithRetry]);

  useEffect(() => {
    const isInitialSync = !hasShownAcknowledgment && contacts.length === 1 &&
      contacts[0]?.display_name?.toLowerCase().includes('whatsapp bridge bot');
    if (isInitialSync) {
      setShowAcknowledgment(true);
      setHasShownAcknowledgment(true);
    }
  }, [hasShownAcknowledgment, contacts]);

  // Initialize avatar cache hook
  const { prefetchAvatars, clearExpiredAvatars } = useAvatarCache();

  // Prefetch avatars for visible contacts
  useEffect(() => {
    if (contacts && contacts.length > 0) {
      // Get contacts with avatar URLs
      const contactsWithAvatars = contacts.filter(c => c.avatar_url);
      console.log(`Found ${contactsWithAvatars.length} contacts with avatars out of ${contacts.length} total`);

      // Prefetch avatars in the background
      prefetchAvatars(contactsWithAvatars);

      // Clear expired avatars once per session
      clearExpiredAvatars(7); // Clear avatars older than 7 days
    }
  }, [contacts, prefetchAvatars, clearExpiredAvatars]);

  const filteredContacts = useMemo(() => {
    const displayNameMap = new Map();
    return contacts.filter(contact => {
      const displayName = contact.display_name?.toLowerCase() || '';
      const isBridgeBot = displayName === 'whatsapp bridge bot';
      const isStatusBroadcast = displayName.includes('whatsapp status') ||
                               displayName.includes('broadcast');
      if (isBridgeBot || isStatusBroadcast) return false;

      if (displayNameMap.has(displayName)) {
        const existing = displayNameMap.get(displayName);
        const existingTime = new Date(existing.last_message_at || 0).getTime();
        const currentTime = new Date(contact.last_message_at || 0).getTime();
        if (currentTime > existingTime) {
          displayNameMap.set(displayName, contact);
          return true;
        }
        return false;
      }
      displayNameMap.set(displayName, contact);
      return true;
    });
  }, [contacts]);

  const searchedContacts = useMemo(() => {
    if (!searchQuery.trim()) return filteredContacts;
    return filteredContacts.filter(contact =>
      contact.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [filteredContacts, searchQuery]);

  // Check if the current platform is active and refresh if needed
  useEffect(() => {
    // Check if this component should be active based on localStorage
    const checkAndRefreshIfActive = () => {
      const activePlatform = localStorage.getItem('dailyfix_active_platform');
      if (activePlatform === 'whatsapp') {
        logger.info('[WhatsappContactList] WhatsApp is the active platform, refreshing contacts');
        loadContactsWithRetry();
      }
    };
    
    // Check on mount and when platform status changes
    checkAndRefreshIfActive();
    
    // Listen for platform changes
    const handlePlatformChange = () => {
      checkAndRefreshIfActive();
    };
    
    // Use the simpler event without complex details
    window.addEventListener('platform-connection-changed', handlePlatformChange);
    window.addEventListener('refresh-platform-status', handlePlatformChange);
    
    return () => {
      window.removeEventListener('platform-connection-changed', handlePlatformChange);
      window.removeEventListener('refresh-platform-status', handlePlatformChange);
    };
  }, [loadContactsWithRetry]);

  useEffect(() => {
    if (!session) {
      logger.warn('[WhatsAppContactList] No session found, redirecting to login');
      navigate('/login');
      return;
    }
    loadContactsWithRetry();
  }, [session, navigate, loadContactsWithRetry]);

  return (
    <Card className="contact-list-container whatsapp-contact-list flex flex-col h-full w-[100%] md:w-full border-none shadow-none rounded-lg">
      {/* Header */}
      <CardHeader className="p-4 bg-neutral-900 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[#ece5dd] font-bold text-xl">Chats</CardTitle>
          <div className="flex items-center space-x-2 relative">
            {isRefreshing ? (
              <MdCloudSync className="animate-spin text-[#66b5ac] w-6 h-6" />
            ) : refreshCooldown ? (
              <MdCloudSync className="text-[#66b5ac] w-6 h-6 pulse-animation" />
            ) : (
              <FiRefreshCw className="text-[#66b5ac] w-6 h-6" />
            )}
            <div className="flex flex-col">
              <Button
                ref={refreshButtonRef}
                onClick={handleRefresh}
                disabled={loading || isRefreshing}
                variant="ghost"
                className={`bg-neutral-900 border-white/10 text-white inline-flex px-3 py-1 md:py-2 items-center justify-center rounded-2xl text-sm ${
                  loading || isRefreshing ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-70'
                } ${refreshCooldown ? 'bg-gray-700' : ''}`}
                onMouseEnter={() => refreshCooldown && setRefreshTooltip('Sync in progress')}
                onMouseLeave={() => setRefreshTooltip('')}
              >
                {isRefreshing ? 'Syncing...' : refreshCooldown ? 'Syncing...' : 'Refresh'}
                {syncProgress && syncProgress.state === SYNC_STATES.SYNCING && syncProgress.progress > 0 && (
                  <span className="ml-1 text-xs">{syncProgress.progress}%</span>
                )}
              </Button>

              {/* Progress bar */}
              {syncProgress && syncProgress.state === SYNC_STATES.SYNCING && (
                <Progress 
                  value={syncProgress.progress || 0} 
                  className="h-1 w-full bg-neutral-700"
                />
              )}
            </div>
            {refreshTooltip && (
              <div className="absolute top-full mt-2 right-0 bg-black text-white text-xs rounded py-1 px-2 z-10">
                {refreshTooltip}
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Search Input */}
      <div className="sticky top-0 z-10 p-4 bg-white border-b border-gray-200">
        <div className="relative">
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            className="w-full bg-white text-black px-10 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-1 focus:ring-[#075e54] placeholder-gray-500"
          />
          <FiSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          {searchQuery && (
            <Button
              onClick={() => setSearchQuery('')}
              variant="ghost"
              size="icon"
              className="absolute right-3 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0 text-gray-500 hover:text-gray-700"
            >
              <FiX className="h-4 w-4" />
              <span className="sr-only">Clear search</span>
            </Button>
          )}
        </div>
      </div>

      {/* Contact List */}
      <CardContent className="flex-1 overflow-y-auto bg-white p-0">
        {loading ? (
          <ShimmerContactList />
        ) : error ? (
          <div className="flex flex-col items-center justify-center p-4">
            <ErrorMessage message={`Failed to load contacts: ${error}`} />
            <Button
              onClick={() => loadContactsWithRetry()}
              variant="default"
              className="bg-[#075e54] text-white hover:bg-[#064c44] mt-4"
            >
              Retry
            </Button>
          </div>
        ) : !searchedContacts?.length ? (
          <div className="flex flex-col items-center justify-center p-4 h-full min-h-[300px]">
            <p className="text-gray-500">
              {searchQuery
                ? `No contacts found matching "${searchQuery}"`
                : syncProgress
                  ? 'Syncing contacts...'
                  : 'Application syncs new contacts with new messages 🔃'
              }
            </p>
          </div>
        ) : (
          <div className="contact-list divide-y divide-gray-200">
            {searchedContacts.map(contact => (
              <ContactItem
                key={contact.id}
                contact={contact}
                isSelected={contact.id === selectedContactId}
                onClick={() => handleContactSelect(contact)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

ContactItem.propTypes = {
  contact: PropTypes.shape({
    id: PropTypes.number.isRequired,
    whatsapp_id: PropTypes.string.isRequired,
    display_name: PropTypes.string.isRequired,
    // profile_photo_url: PropTypes.string,
    is_group: PropTypes.bool,
    last_message: PropTypes.string,
    // unread_count: PropTypes.number,
    sync_status: PropTypes.string,
    membership: PropTypes.string,
    // last_sync_at: PropTypes.string,
    // bridge_room_id: PropTypes.string,
    // metadata: PropTypes.shape({
    //   membership: PropTypes.string,
    //   room_id: PropTypes.string,
    //   member_count: PropTypes.number,
    //   // last_sync_check: PropTypes.string,
    //   // bridge_bot_status: PropTypes.string
    // })
  }).isRequired,
  isSelected: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired
};

WhatsAppContactList.propTypes = {
  onContactSelect: PropTypes.func.isRequired,
  selectedContactId: PropTypes.number
};

export default WhatsAppContactList;