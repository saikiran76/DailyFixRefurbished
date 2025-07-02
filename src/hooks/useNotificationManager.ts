import { useEffect, useRef, useState, useCallback } from 'react';
import { useInboxNotifications } from '@liveblocks/react';
import logger from '@/utils/logger';

interface NotificationManagerOptions {
  enableSound?: boolean;
  enableBrowserNotifications?: boolean;
  soundVolume?: number;
}

interface NotificationData {
  id: string;
  platform: 'whatsapp' | 'telegram';
  title: string;
  message: string;
  sender: string;
  timestamp: number;
}

export function useNotificationManager(options: NotificationManagerOptions = {}) {
  const {
    enableSound = true,
    enableBrowserNotifications = true,
    soundVolume = 0.7
  } = options;

  const { inboxNotifications } = useInboxNotifications();
  const [hasPermission, setHasPermission] = useState<NotificationPermission>('default');
  const [isAudioEnabled, setIsAudioEnabled] = useState(enableSound);
  const previousNotificationsRef = useRef<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  
  // CRITICAL FIX: Add sound throttling to prevent multiple rapid plays
  const lastSoundPlayTime = useRef<Map<string, number>>(new Map());
  const activeSounds = useRef<Set<AudioBufferSourceNode>>(new Set());
  const SOUND_COOLDOWN_MS = 1000; // 1 second minimum between same platform sounds
  const MAX_CONCURRENT_SOUNDS = 1; // Only allow 1 sound at a time
  
  // CRITICAL FIX: Add notification deduplication
  const processedNotifications = useRef<Map<string, number>>(new Map());
  const NOTIFICATION_DEDUP_MS = 2000; // 2 seconds deduplication window

  // Create a pleasant notification tone using modern audio synthesis techniques
  const createBeepTone = useCallback((audioContext: AudioContext, frequency: number): AudioBuffer => {
    const sampleRate = audioContext.sampleRate;
    const duration = 0.6; // Slightly longer for pleasant decay
    const length = sampleRate * duration;
    const buffer = audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // ADSR envelope parameters (in seconds)
    const attackTime = 0.02;  // Quick but smooth attack
    const decayTime = 0.1;    // Short decay
    const sustainLevel = 0.4; // Moderate sustain level
    const releaseTime = 0.48; // Long, pleasant release
    
    // Convert to samples
    const attackSamples = Math.floor(attackTime * sampleRate);
    const decaySamples = Math.floor(decayTime * sampleRate);
    const sustainSamples = Math.floor((duration - attackTime - decayTime - releaseTime) * sampleRate);
    const releaseSamples = length - attackSamples - decaySamples - sustainSamples;

    // Create pleasant notification tones with harmonics
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let envelope = 1;
      
      // ADSR Envelope calculation
      if (i < attackSamples) {
        // Attack: exponential curve for natural sound
        const progress = i / attackSamples;
        envelope = Math.pow(progress, 0.6); // Slightly curved attack
      } else if (i < attackSamples + decaySamples) {
        // Decay: exponential decay to sustain level
        const progress = (i - attackSamples) / decaySamples;
        envelope = 1 - (1 - sustainLevel) * progress;
      } else if (i < attackSamples + decaySamples + sustainSamples) {
        // Sustain: constant level
        envelope = sustainLevel;
      } else {
        // Release: exponential decay to zero
        const progress = (i - attackSamples - decaySamples - sustainSamples) / releaseSamples;
        envelope = sustainLevel * Math.pow(1 - progress, 2); // Curved release
      }
      
      let sample = 0;
      
      if (frequency === 800) {
        // Telegram-style: Two-tone pleasant bell sound (major third interval)
        const freq1 = 659.25; // E5
        const freq2 = 830.61; // G#5 (major third above)
        
        // Primary tones with harmonics
        sample += Math.sin(2 * Math.PI * freq1 * t) * 0.6;
        sample += Math.sin(2 * Math.PI * freq2 * t) * 0.4;
        
        // Add subtle harmonics for richness
        sample += Math.sin(2 * Math.PI * freq1 * 2 * t) * 0.15; // Second harmonic
        sample += Math.sin(2 * Math.PI * freq2 * 2 * t) * 0.1;  // Second harmonic
        
        // Add a subtle sub-harmonic for warmth
        sample += Math.sin(2 * Math.PI * freq1 * 0.5 * t) * 0.1;
        
      } else {
        // WhatsApp-style: Single pleasant tone with perfect fifth (C + G)
        const freq1 = 523.25; // C5
        const freq2 = 783.99; // G5 (perfect fifth above)
        
        // Primary tones
        sample += Math.sin(2 * Math.PI * freq1 * t) * 0.7;
        sample += Math.sin(2 * Math.PI * freq2 * t) * 0.3;
        
        // Add harmonics for bell-like quality
        sample += Math.sin(2 * Math.PI * freq1 * 2 * t) * 0.2;  // Octave
        sample += Math.sin(2 * Math.PI * freq1 * 3 * t) * 0.1;  // Fifth above octave
        
        // Add subtle modulation for organic feel
        const modulation = Math.sin(2 * Math.PI * 4 * t) * 0.05; // 4Hz vibrato
        sample += Math.sin(2 * Math.PI * freq1 * (1 + modulation) * t) * 0.1;
      }
      
      // Apply envelope and normalize
      data[i] = sample * envelope * 0.3; // Overall volume control
    }

    return buffer;
  }, []);

  // Load notification sound files with better error handling
  const loadNotificationSounds = useCallback(async () => {
    if (!audioContextRef.current) return;

    // Try multiple potential paths for the audio file
    const soundFilePaths = [
      '/sounds/tone-clen.wav',
      './sounds/tone-clen.wav',
      '/public/sounds/tone-clen.wav',
      './public/sounds/tone-clen.wav'
    ];
    
    let audioBuffer = null;
    let loadedFromPath = null;
    
    // Try each path until one works
    for (const soundFile of soundFilePaths) {
      try {
        logger.info(`[NotificationManager] Attempting to load notification sound: ${soundFile}`);
        
        const response = await fetch(soundFile);
        
        if (!response.ok) {
          logger.warn(`[NotificationManager] Failed to load ${soundFile} (${response.status})`);
          continue; // Try next path
        }

        const arrayBuffer = await response.arrayBuffer();
        logger.info(`[NotificationManager] Downloaded audio data from ${soundFile}:`, {
          size: arrayBuffer.byteLength,
          type: 'ArrayBuffer',
          file: soundFile
        });

        if (arrayBuffer.byteLength === 0) {
          logger.warn(`[NotificationManager] Audio file ${soundFile} is empty, trying next path`);
          continue; // Try next path
        }

        // Try to decode the audio data
        try {
          audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
          loadedFromPath = soundFile;
          logger.info(`[NotificationManager] Successfully loaded and decoded sound from ${soundFile}:`, {
            duration: audioBuffer.duration,
            sampleRate: audioBuffer.sampleRate,
            channels: audioBuffer.numberOfChannels,
            file: soundFile
          });
          break; // Success! Exit the loop
        } catch (decodeError) {
          logger.warn(`[NotificationManager] Failed to decode audio data from ${soundFile}:`, decodeError);
          continue; // Try next path
        }
        
      } catch (error) {
        logger.warn(`[NotificationManager] Error loading sound file ${soundFile}:`, error);
        continue; // Try next path
      }
    }
    
    if (audioBuffer && loadedFromPath) {
      // Successfully loaded the audio file
      soundBuffersRef.current.set('whatsapp', audioBuffer);
      soundBuffersRef.current.set('telegram', audioBuffer);
      
      logger.info(`[NotificationManager] ✅ Successfully using real audio file from ${loadedFromPath} for both platforms`);
    } else {
      // All paths failed, use high-quality generated tones
      logger.warn(`[NotificationManager] All audio file paths failed, using high-quality generated tones`);
      
      const whatsappBuffer = createBeepTone(audioContextRef.current, 600);
      const telegramBuffer = createBeepTone(audioContextRef.current, 800);
      soundBuffersRef.current.set('whatsapp', whatsappBuffer);
      soundBuffersRef.current.set('telegram', telegramBuffer);
      
      logger.info('[NotificationManager] ✅ High-quality generated notification tones created for both platforms');
    }
  }, [createBeepTone]);

  // Initialize audio context and load sounds
  useEffect(() => {
    const initializeAudio = async () => {
      if (!isAudioEnabled) return;

      try {
        // Create audio context (handle browser restrictions)
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Load notification sounds
        await loadNotificationSounds();
        
        logger.info('[NotificationManager] Audio system initialized');
      } catch (error) {
        logger.error('[NotificationManager] Failed to initialize audio:', error);
        setIsAudioEnabled(false);
      }
    };

    initializeAudio();

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      
      // CRITICAL: Stop all active sounds on cleanup to prevent orphaned audio
      activeSounds.current.forEach(source => {
        try {
          source.stop();
        } catch (error) {
          // Ignore errors when stopping sounds during cleanup
        }
      });
      activeSounds.current.clear();
      
      logger.info('[NotificationManager] Audio cleanup completed - all active sounds stopped');
    };
  }, [isAudioEnabled, loadNotificationSounds]);

  // Request notification permission
  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      logger.warn('[NotificationManager] Browser notifications not supported');
      return 'denied';
    }

    if (Notification.permission === 'granted') {
      setHasPermission('granted');
      return 'granted';
    }

    if (Notification.permission === 'denied') {
      setHasPermission('denied');
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();
      setHasPermission(permission);
      logger.info(`[NotificationManager] Notification permission: ${permission}`);
      return permission;
    } catch (error) {
      logger.error('[NotificationManager] Error requesting notification permission:', error);
      setHasPermission('denied');
      return 'denied';
    }
  }, []);

  // Play notification sound - CRITICAL FIX: Added throttling and overlap prevention
  const playNotificationSound = useCallback(async (platform: 'whatsapp' | 'telegram') => {
    if (!isAudioEnabled || !audioContextRef.current) {
      logger.info(`[NotificationManager] Sound disabled or no audio context for ${platform}`);
      return;
    }

    const now = Date.now();
    const lastPlayTime = lastSoundPlayTime.current.get(platform) || 0;
    const timeSinceLastPlay = now - lastPlayTime;

    // CRITICAL: Check cooldown period to prevent rapid multiple plays
    if (timeSinceLastPlay < SOUND_COOLDOWN_MS) {
      logger.warn(`[NotificationManager] BLOCKED: ${platform} sound blocked by cooldown. ${SOUND_COOLDOWN_MS - timeSinceLastPlay}ms remaining`);
      return;
    }

    // CRITICAL: Check if we have too many concurrent sounds
    if (activeSounds.current.size >= MAX_CONCURRENT_SOUNDS) {
      logger.warn(`[NotificationManager] BLOCKED: Too many concurrent sounds (${activeSounds.current.size}), stopping all active sounds`);
      
      // Stop all active sounds to prevent cacophony
      activeSounds.current.forEach(source => {
        try {
          source.stop();
        } catch (error) {
          // Ignore errors when stopping sounds
        }
      });
      activeSounds.current.clear();
    }

    try {
      // Resume audio context if suspended (required by some browsers)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
        logger.info('[NotificationManager] Audio context resumed');
      }

      const soundBuffer = soundBuffersRef.current.get(platform);
      if (!soundBuffer) {
        logger.warn(`[NotificationManager] No sound buffer found for ${platform}`);
        return;
      }

      // CRITICAL: Record play time BEFORE creating sound to prevent race conditions
      lastSoundPlayTime.current.set(platform, now);

      const source = audioContextRef.current.createBufferSource();
      const gainNode = audioContextRef.current.createGain();
      
      source.buffer = soundBuffer;
      gainNode.gain.value = soundVolume;
      
      source.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);
      
      // CRITICAL: Track active sound and clean up when it ends
      activeSounds.current.add(source);
      
      source.onended = () => {
        activeSounds.current.delete(source);
        logger.debug(`[NotificationManager] Sound ended for ${platform}, active sounds: ${activeSounds.current.size}`);
      };
      
      source.start();
      
      logger.info(`[NotificationManager] ✅ SAFELY played ${platform} notification sound`, {
        volume: soundVolume,
        duration: soundBuffer.duration,
        activeSounds: activeSounds.current.size,
        cooldownMs: SOUND_COOLDOWN_MS
      });
      
      // CRITICAL: Auto-cleanup after sound duration + buffer time
      setTimeout(() => {
        if (activeSounds.current.has(source)) {
          activeSounds.current.delete(source);
          logger.debug(`[NotificationManager] Auto-cleanup sound for ${platform}`);
        }
      }, (soundBuffer.duration * 1000) + 100);
      
    } catch (error) {
      logger.error(`[NotificationManager] Failed to play ${platform} sound:`, error);
      // Reset cooldown on error to allow retry
      lastSoundPlayTime.current.delete(platform);
    }
  }, [isAudioEnabled, soundVolume]);

  // Show browser notification (fixed - removed invalid timestamp property)
  const showBrowserNotification = useCallback(async (data: NotificationData) => {
    logger.info(`[NotificationManager] Attempting to show browser notification`, {
      enableBrowserNotifications,
      hasPermission,
      platform: data.platform,
      title: data.title
    });

    if (!enableBrowserNotifications) {
      logger.info('[NotificationManager] Browser notifications disabled in settings');
      return;
    }

    if (hasPermission !== 'granted') {
      logger.warn(`[NotificationManager] Browser notification permission not granted: ${hasPermission}`);
      return;
    }

    try {
      // Use fallback icons or omit them if placeholder files exist
      const notificationOptions: NotificationOptions = {
        body: data.message,
        tag: `${data.platform}-${data.id}`, // Prevent duplicate notifications
        requireInteraction: false,
        silent: true, // We handle sound separately
        data: {
          platform: data.platform,
          contactId: data.id,
          url: window.location.origin
        }
      };

      // Only add icon if we have real icon files (not placeholder text files)
      // For now, we'll skip icons to avoid potential issues with placeholder files
      // TODO: Replace placeholder files with actual PNG icons
      
      logger.info(`[NotificationManager] Creating notification with options:`, notificationOptions);

      const notification = new Notification(data.title, notificationOptions);

      // Handle notification click
      notification.onclick = () => {
        logger.info(`[NotificationManager] Notification clicked for ${data.platform} contact ${data.id}`);
        window.focus();
        
        // Dispatch event to navigate to the chat
        window.dispatchEvent(new CustomEvent('navigate-to-chat', {
          detail: {
            platform: data.platform,
            contactId: data.id,
          }
        }));
        
        notification.close();
      };

      // Handle notification errors
      notification.onerror = (error) => {
        logger.error('[NotificationManager] Notification error:', error);
      };

      // Auto-close after 5 seconds
      setTimeout(() => {
        notification.close();
      }, 5000);

      logger.info(`[NotificationManager] Successfully showed browser notification for ${data.platform}`);
    } catch (error) {
      logger.error('[NotificationManager] Failed to show browser notification:', error);
    }
  }, [enableBrowserNotifications, hasPermission]);

  // Extract notification data from Liveblocks notification
  const extractNotificationData = useCallback((notification: any): NotificationData | null => {
    logger.info(`[NotificationManager] Extracting notification data:`, {
      id: notification.id,
      kind: notification.kind,
      subjectId: (notification as any).subjectId,
      readAt: notification.readAt,
      activities: notification.activities?.length || 0
    });

    const activityData = notification?.activities?.[0]?.data;
    if (!activityData) {
      logger.warn(`[NotificationManager] No activity data found in notification:`, notification);
      return null;
    }

    logger.info(`[NotificationManager] Activity data found:`, {
      sender: activityData.sender,
      contact_display_name: activityData.contact_display_name,
      message: activityData.message?.substring(0, 50) + '...',
      timestamp: activityData.timestamp
    });

    // Filter out bridge bot notifications
    const displayName = String(activityData.contact_display_name || activityData.sender || '').toLowerCase();
    if (displayName.includes('bridge bot') || 
        displayName.includes('telegram bridge') ||
        displayName.includes('whatsapp bridge')) {
      logger.info(`[NotificationManager] Filtering out bridge bot notification from: ${displayName}`);
      return null;
    }

    // Determine platform with proper typing
    const platform: 'whatsapp' | 'telegram' = notification.kind.startsWith('$telegram') ? 'telegram' : 'whatsapp';
    
    // Extract sender and message
    const sender = activityData.contact_display_name || activityData.sender || 'Unknown';
    const message = activityData.message || 'New message';
    
    // Create title based on platform
    const title = platform === 'telegram' 
      ? `Telegram - ${sender}`
      : `WhatsApp - ${sender}`;

    const notificationData: NotificationData = {
      id: (notification as any).subjectId || notification.id,
      platform,
      title,
      message: message.length > 100 ? message.substring(0, 100) + '...' : message,
      sender,
      timestamp: Date.now()
    };

    logger.info(`[NotificationManager] Successfully extracted notification data:`, notificationData);
    return notificationData;
  }, []);

  // Monitor for new notifications
  useEffect(() => {
    logger.info(`[NotificationManager] Monitoring notifications. Current count: ${inboxNotifications?.length || 0}`);
    
    if (!inboxNotifications) {
      logger.info(`[NotificationManager] No inbox notifications available yet`);
      return;
    }

    const currentNotificationIds = new Set(
      inboxNotifications
        .filter(n => {
          const isUnread = !n.readAt;
          logger.debug(`[NotificationManager] Notification ${n.id}: readAt=${n.readAt}, isUnread=${isUnread}`);
          return isUnread;
        })
        .map(n => n.id)
    );

    const previousNotificationIds = previousNotificationsRef.current;
    
    logger.info(`[NotificationManager] Current unread notifications: ${currentNotificationIds.size}, Previous: ${previousNotificationIds.size}`);
    
    // Find new notifications
    const newNotificationIds = [...currentNotificationIds].filter(
      id => !previousNotificationIds.has(id)
    );

    if (newNotificationIds.length > 0) {
      logger.info(`[NotificationManager] 🔔 Detected ${newNotificationIds.length} NEW notifications:`, newNotificationIds);

      // Process each new notification
      newNotificationIds.forEach(notificationId => {
        const notification = inboxNotifications.find(n => n.id === notificationId);
        if (!notification) {
          logger.warn(`[NotificationManager] Could not find notification with ID: ${notificationId}`);
          return;
        }

        // CRITICAL: Check for notification deduplication
        const now = Date.now();
        const lastProcessedTime = processedNotifications.current.get(notificationId) || 0;
        const timeSinceLastProcessed = now - lastProcessedTime;

        if (timeSinceLastProcessed < NOTIFICATION_DEDUP_MS) {
          logger.warn(`[NotificationManager] BLOCKED: Duplicate notification ${notificationId} within ${NOTIFICATION_DEDUP_MS}ms window`);
          return;
        }

        // Record that we're processing this notification
        processedNotifications.current.set(notificationId, now);

        logger.info(`[NotificationManager] Processing notification:`, {
          id: notification.id,
          kind: notification.kind,
          subjectId: (notification as any).subjectId,
          timeSinceLastProcessed
        });

        const notificationData = extractNotificationData(notification);
        if (!notificationData) {
          logger.info(`[NotificationManager] Notification filtered out (bridge bot or invalid data)`);
          return;
        }

        logger.info(`[NotificationManager] 🎯 Processing valid notification:`, {
          platform: notificationData.platform,
          sender: notificationData.sender,
          message: notificationData.message.substring(0, 50) + '...',
          hasPermission,
          enableBrowserNotifications,
          isAudioEnabled
        });

        // Play sound with throttling
        if (isAudioEnabled) {
          logger.info(`[NotificationManager] 🔊 Attempting to play sound for ${notificationData.platform}`);
          playNotificationSound(notificationData.platform);
        } else {
          logger.info(`[NotificationManager] 🔇 Audio disabled, skipping sound`);
        }

        // Show browser notification
        if (enableBrowserNotifications) {
          logger.info(`[NotificationManager] 🔔 Showing browser notification for ${notificationData.platform}`);
          showBrowserNotification(notificationData);
        } else {
          logger.info(`[NotificationManager] 🔕 Browser notifications disabled, skipping`);
        }
      });
    } else {
      logger.debug(`[NotificationManager] No new notifications detected`);
    }

    // Update previous notifications
    previousNotificationsRef.current = currentNotificationIds;
    
    // CRITICAL: Cleanup old entries to prevent memory leaks
    const cleanupTime = Date.now() - Math.max(NOTIFICATION_DEDUP_MS, SOUND_COOLDOWN_MS) * 2;
    
    // Clean up old processed notifications
    for (const [notificationId, timestamp] of processedNotifications.current.entries()) {
      if (timestamp < cleanupTime) {
        processedNotifications.current.delete(notificationId);
      }
    }
    
    // Clean up old sound play times
    for (const [platform, timestamp] of lastSoundPlayTime.current.entries()) {
      if (timestamp < cleanupTime) {
        lastSoundPlayTime.current.delete(platform);
      }
    }
    
    logger.debug(`[NotificationManager] Cleanup completed. Tracked notifications: ${processedNotifications.current.size}, Sound cooldowns: ${lastSoundPlayTime.current.size}`);
  }, [inboxNotifications, isAudioEnabled, enableBrowserNotifications, playNotificationSound, showBrowserNotification, extractNotificationData, hasPermission]);

  // Initialize notification permission on mount
  useEffect(() => {
    if (enableBrowserNotifications) {
      const currentPermission = Notification.permission;
      setHasPermission(currentPermission);
      logger.info(`[NotificationManager] Current notification permission: ${currentPermission}`);
      
      // Auto-request permission if default
      if (currentPermission === 'default') {
        // Delay the request slightly to avoid immediate popup
        setTimeout(() => {
          logger.info('[NotificationManager] Auto-requesting notification permission');
          requestNotificationPermission();
        }, 1000);
      }
    }
  }, [enableBrowserNotifications, requestNotificationPermission]);

  // Force permission check on every render to catch external permission changes
  useEffect(() => {
    if (enableBrowserNotifications && typeof window !== 'undefined' && 'Notification' in window) {
      const currentPermission = Notification.permission;
      if (currentPermission !== hasPermission) {
        logger.info(`[NotificationManager] Permission changed: ${hasPermission} -> ${currentPermission}`);
        setHasPermission(currentPermission);
      }
    }
  });

  // Enable audio on first user interaction (required by browsers)
  useEffect(() => {
    const enableAudioOnInteraction = async () => {
      if (!isAudioEnabled || !audioContextRef.current) return;
      
      if (audioContextRef.current.state === 'suspended') {
        try {
          await audioContextRef.current.resume();
          logger.info('[NotificationManager] Audio context resumed after user interaction');
        } catch (error) {
          logger.error('[NotificationManager] Failed to resume audio context:', error);
        }
      }
    };

    // Listen for first user interaction
    const events = ['click', 'touchstart', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, enableAudioOnInteraction, { once: true });
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, enableAudioOnInteraction);
      });
    };
  }, [isAudioEnabled]);

  return {
    hasPermission,
    isAudioEnabled,
    requestNotificationPermission,
    playNotificationSound,
    showBrowserNotification,
    setIsAudioEnabled,
    
    // CRITICAL: Emergency stop function to immediately stop all sounds
    stopAllSounds: () => {
      logger.warn('[NotificationManager] 🚨 EMERGENCY STOP: Stopping all active sounds');
      activeSounds.current.forEach(source => {
        try {
          source.stop();
        } catch (error) {
          // Ignore errors when stopping sounds
        }
      });
      activeSounds.current.clear();
      
      // Reset cooldowns to allow immediate new sounds if needed
      lastSoundPlayTime.current.clear();
      
      logger.info('[NotificationManager] ✅ Emergency stop completed - all sounds stopped');
    },
    
    // Debug/test functions
    testNotification: async (platform: 'whatsapp' | 'telegram' = 'whatsapp') => {
      logger.info(`[NotificationManager] 🧪 Testing ${platform} notification manually`);
      
      // Check if notifications are supported
      if (!('Notification' in window)) {
        logger.error('[NotificationManager] Browser does not support notifications');
        return false;
      }
      
      // Check current permission
      const currentPermission = Notification.permission;
      logger.info(`[NotificationManager] Current permission: ${currentPermission}`);
      
      // Test permission first
      if (currentPermission !== 'granted') {
        logger.warn(`[NotificationManager] Permission not granted: ${currentPermission}, requesting...`);
        const newPermission = await requestNotificationPermission();
        logger.info(`[NotificationManager] Permission request result: ${newPermission}`);
        
        if (newPermission !== 'granted') {
          logger.error(`[NotificationManager] Failed to get permission: ${newPermission}`);
          return false;
        }
      }
      
      // Test notification
      const testData: NotificationData = {
        id: 'test-' + Date.now(),
        platform,
        title: `Test ${platform.charAt(0).toUpperCase() + platform.slice(1)} Notification`,
        message: 'This is a test notification to verify the system is working correctly.',
        sender: 'Test User',
        timestamp: Date.now()
      };
      
      logger.info(`[NotificationManager] Creating test notification:`, testData);
      
      // Test sound first
      if (isAudioEnabled) {
        logger.info(`[NotificationManager] Testing sound for ${platform}`);
        await playNotificationSound(platform);
      } else {
        logger.info(`[NotificationManager] Audio disabled, skipping sound test`);
      }
      
      // Test browser notification
      if (enableBrowserNotifications) {
        logger.info(`[NotificationManager] Testing browser notification for ${platform}`);
        await showBrowserNotification(testData);
        return true;
      } else {
        logger.warn(`[NotificationManager] Browser notifications disabled in settings`);
        return false;
      }
    },
    // Debug info
    getDebugInfo: () => ({
      hasPermission,
      isAudioEnabled,
      enableBrowserNotifications,
      soundBuffersLoaded: Array.from(soundBuffersRef.current.keys()),
      audioContextState: audioContextRef.current?.state,
      notificationCount: inboxNotifications?.length || 0,
      unreadCount: inboxNotifications?.filter(n => !n.readAt).length || 0,
      
      // CRITICAL: Add throttling debug info
      activeSoundsCount: activeSounds.current.size,
      soundCooldowns: Object.fromEntries(lastSoundPlayTime.current.entries()),
      processedNotificationsCount: processedNotifications.current.size,
      soundCooldownMs: SOUND_COOLDOWN_MS,
      notificationDedupMs: NOTIFICATION_DEDUP_MS,
      maxConcurrentSounds: MAX_CONCURRENT_SOUNDS
    })
  };
} 