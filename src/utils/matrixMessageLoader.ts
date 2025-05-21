/**
 * Matrix Message Loader
 *
 * A reliable message loading utility based on Element-web's approach
 */
import logger from './logger';
import matrixCacheManager from './matrixCacheManager';

class MatrixMessageLoader {
  constructor() {
    this.client = null;
    this.initialized = false;
    this.roomListeners = new Map();
    this.messageCache = new Map();
  }

  /**
   * Initialize the message loader with a Matrix client
   * @param {Object} client - Matrix client
   * @returns {boolean} - Whether initialization was successful
   */
  async initialize(client) {
    if (!client) {
      logger.error('[MatrixMessageLoader] Cannot initialize: no client provided');
      return false;
    }

    this.client = client;

    // Initialize the cache manager
    try {
      const userId = client.getUserId();
      if (userId) {
        await matrixCacheManager.initialize(userId);
        logger.info('[MatrixMessageLoader] Cache manager initialized');
      } else {
        logger.warn('[MatrixMessageLoader] Could not get user ID for cache initialization');
      }
    } catch (error) {
      logger.warn('[MatrixMessageLoader] Error initializing cache manager:', error);
      // Continue even if cache initialization fails
    }

    this.initialized = true;
    logger.info('[MatrixMessageLoader] Initialized');
    return true;
  }

  /**
   * Load messages for a room
   * @param {string} roomId - Room ID
   * @param {Object} options - Options
   * @returns {Promise<Array>} - Array of messages
   */
  async loadMessages(roomId, options = {}) {
    if (!this.initialized || !this.client) {
      logger.error('[MatrixMessageLoader] Cannot load messages: not initialized');
      return [];
    }

    if (!roomId) {
      logger.error('[MatrixMessageLoader] Cannot load messages: no roomId provided');
      return [];
    }

    const {
      limit = 100,
      forceRefresh = false
    } = options;

    try {
      // Get the room
      const room = this.client.getRoom(roomId);
      if (!room) {
        logger.error(`[MatrixMessageLoader] Room not found: ${roomId}`);
        return [];
      }

      // Try to get messages from cache first if not forcing refresh
      if (!forceRefresh) {
        try {
          const cachedMessages = await matrixCacheManager.getMessages(roomId, { limit });
          if (cachedMessages && cachedMessages.length > 0) {
            logger.info(`[MatrixMessageLoader] Using ${cachedMessages.length} cached messages for room ${roomId}`);
            return cachedMessages;
          }
        } catch (cacheError) {
          logger.warn('[MatrixMessageLoader] Error getting cached messages:', cacheError);
          // Continue with normal loading if cache fails
        }
      } else if (forceRefresh) {
        // Clear cache if force refresh
        try {
          await matrixCacheManager.clearRoomCache(roomId);
          logger.info(`[MatrixMessageLoader] Cleared cache for room ${roomId}`);
        } catch (clearError) {
          logger.warn('[MatrixMessageLoader] Error clearing room cache:', clearError);
        }
      }

      // Multi-layered approach to message loading
      const messages = [];
      let loadingMethod = '';

      // 1. Try to use the timeline
      try {
        // Force a room initial sync to get the latest messages
        await this.client.roomInitialSync(roomId, 50);

        // Get the timeline
        const timeline = room.getLiveTimeline();

        if (timeline) {
          // Get events from the timeline
          let events = timeline.getEvents();

          // If we have very few events, try to paginate
          if (events.length < limit) {
            try {
              // Paginate backwards to get more events
              await this.client.paginateEventTimeline(timeline, { backwards: true, limit });
              events = timeline.getEvents();
            } catch (error) {
              logger.warn('[MatrixMessageLoader] Error paginating timeline:', error);
            }
          }

          if (events.length > 0) {
            // Process events into messages
            for (const event of events) {
              if (this.isDisplayableEvent(event)) {
                messages.push(this.createMessageFromEvent(event, room));
              }
            }
            loadingMethod = 'timeline';
          }
        }
      } catch (error) {
        logger.warn('[MatrixMessageLoader] Error loading from timeline:', error);
      }

      // 2. If we didn't get enough messages, try the roomMessages API
      if (messages.length < limit) {
        try {
          // Use roomMessages API to get the most recent messages
          const response = await this.client.roomMessages(roomId, null, limit, 'b');

          if (response && response.chunk && response.chunk.length > 0) {
            // Process events into messages
            for (const event of response.chunk) {
              if (this.isDisplayableEvent(event)) {
                const message = this.createMessageFromEvent(event, room);

                // Avoid duplicates
                if (!messages.some(m => m.id === message.id)) {
                  messages.push(message);
                }
              }
            }

            loadingMethod += (loadingMethod ? ' + ' : '') + 'roomMessages';
          }
        } catch (error) {
          logger.warn('[MatrixMessageLoader] Error loading with roomMessages API:', error);
        }
      }

      // 3. Sort messages by timestamp
      messages.sort((a, b) => a.timestamp - b.timestamp);

      // 4. Cache the messages using the cache manager
      try {
        await matrixCacheManager.cacheMessages(roomId, messages);
        logger.info(`[MatrixMessageLoader] Cached ${messages.length} messages for room ${roomId}`);
      } catch (cacheError) {
        logger.warn('[MatrixMessageLoader] Error caching messages:', cacheError);
        // Continue even if caching fails
      }

      logger.info(`[MatrixMessageLoader] Loaded ${messages.length} messages using ${loadingMethod}`);
      return messages;
    } catch (error) {
      logger.error('[MatrixMessageLoader] Error loading messages:', error);
      return [];
    }
  }

  /**
   * Check if an event should be displayed as a message
   * @param {Object} event - Matrix event
   * @returns {boolean} - Whether the event should be displayed
   */
  isDisplayableEvent(event) {
    if (!event) return false;

    try {
      // Get event type
      const eventType = typeof event.getType === 'function' ? event.getType() :
                        event.type || (event.event && event.event.type);

      // Check if it's a displayable event type
      const displayableTypes = ['m.room.message', 'm.room.encrypted', 'm.sticker'];
      if (!displayableTypes.includes(eventType)) {
        return false;
      }

      // Get content
      const content = typeof event.getContent === 'function' ? event.getContent() :
                      event.content || (event.event && event.event.content);

      // Skip events without content
      if (!content) {
        return false;
      }

      // For message events, check if they have a body or msgtype
      if (eventType === 'm.room.message') {
        return !!(content.body || content.text || content.msgtype);
      }

      return true;
    } catch (error) {
      logger.warn('[MatrixMessageLoader] Error checking if event is displayable:', error);
      return false;
    }
  }

  /**
   * Create a message object from a Matrix event
   * @param {Object} event - Matrix event
   * @param {Object} room - Matrix room
   * @returns {Object} - Message object
   */
  createMessageFromEvent(event, room) {
    try {
      // Get event ID
      const id = typeof event.getId === 'function' ? event.getId() :
                event.event_id || event.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Get sender
      const senderId = typeof event.getSender === 'function' ? event.getSender() :
                      event.sender || event.user_id || (event.event && event.event.sender) || 'Unknown';

      // Get sender display name from room state
      let senderName = senderId;
      if (room) {
        const member = room.getMember(senderId);
        if (member && member.name) {
          senderName = member.name;
        }
      }

      // Get content
      const content = typeof event.getContent === 'function' ? event.getContent() :
                     event.content || (event.event && event.event.content) || {};

      // Get message body
      let body = content.body || content.text || '';

      // If no body, try to create a fallback
      if (!body) {
        const eventType = typeof event.getType === 'function' ? event.getType() :
                         event.type || (event.event && event.event.type);

        if (eventType === 'm.room.encrypted') {
          body = 'Encrypted message';
        } else if (eventType === 'm.sticker') {
          body = 'Sticker';
        } else if (content.msgtype) {
          if (content.msgtype === 'm.image') {
            body = 'Image';
          } else if (content.msgtype === 'm.file') {
            body = 'File';
          } else if (content.msgtype === 'm.audio') {
            body = 'Audio';
          } else if (content.msgtype === 'm.video') {
            body = 'Video';
          } else {
            body = 'Message';
          }
        } else {
          body = 'Message';
        }
      }

      // Get timestamp
      const timestamp = typeof event.getOriginServerTs === 'function' ? event.getOriginServerTs() :
                       event.origin_server_ts || event.timestamp ||
                       (event.event && event.event.origin_server_ts) || Date.now();

      // Check if the message is from the current user
      const isFromMe = this.client && senderId === this.client.getUserId();

      // Create message object
      return {
        id,
        sender: senderId,
        senderName,
        body,
        timestamp,
        isFromMe,
        rawEvent: event,
        content
      };
    } catch (error) {
      logger.warn('[MatrixMessageLoader] Error creating message from event:', error);

      // Return a fallback message
      return {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        sender: 'Unknown',
        senderName: 'Unknown',
        body: 'Error processing message',
        timestamp: Date.now(),
        isFromMe: false,
        rawEvent: event,
        content: {}
      };
    }
  }

  /**
   * Get a parent event for a reply
   * @param {string} roomId - Room ID
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} - Parent event
   */
  async getParentEvent(roomId, eventId) {
    if (!this.initialized || !this.client) {
      logger.error('[MatrixMessageLoader] Cannot get parent event: not initialized');
      return null;
    }

    if (!roomId || !eventId) {
      logger.error('[MatrixMessageLoader] Cannot get parent event: missing roomId or eventId');
      return null;
    }

    try {
      // Try to get the event from cache first
      try {
        const cachedEvent = await matrixCacheManager.getEvent(eventId);
        if (cachedEvent) {
          logger.info(`[MatrixMessageLoader] Using cached event ${eventId}`);
          return cachedEvent;
        }
      } catch (cacheError) {
        logger.warn(`[MatrixMessageLoader] Error getting cached event ${eventId}:`, cacheError);
        // Continue with normal loading if cache fails
      }

      // Get the room
      const room = this.client.getRoom(roomId);
      if (!room) {
        logger.error(`[MatrixMessageLoader] Room not found: ${roomId}`);
        return null;
      }

      // Try to find the event in the timeline
      const timeline = room.getLiveTimeline();
      if (timeline) {
        const events = timeline.getEvents();
        const event = events.find(e => {
          const id = typeof e.getId === 'function' ? e.getId() : e.event_id || e.id;
          return id === eventId;
        });

        if (event) {
          // Cache the event for future use
          try {
            await matrixCacheManager.cacheEvent(roomId, event);
          } catch (cacheError) {
            logger.warn(`[MatrixMessageLoader] Error caching event ${eventId}:`, cacheError);
          }
          return event;
        }
      }

      // Try to use the context API
      try {
        const context = await this.client.getEventContext(roomId, eventId, 1);
        if (context && context.event) {
          return context.event;
        }
      } catch (error) {
        logger.warn(`[MatrixMessageLoader] Error getting event context: ${error.message}`);
      }

      // Try to use roomMessages API
      try {
        const response = await this.client.roomMessages(roomId, null, 100, 'b');
        if (response && response.chunk) {
          const event = response.chunk.find(e => {
            const id = typeof e.getId === 'function' ? e.getId() : e.event_id || e.id;
            return id === eventId;
          });

          if (event) {
            return event;
          }
        }
      } catch (error) {
        logger.warn(`[MatrixMessageLoader] Error using roomMessages API: ${error.message}`);
      }

      logger.warn(`[MatrixMessageLoader] Could not find parent event: ${eventId}`);
      return null;
    } catch (error) {
      logger.error('[MatrixMessageLoader] Error getting parent event:', error);
      return null;
    }
  }

  /**
   * Set up real-time updates for a room
   * @param {string} roomId - Room ID
   * @param {Function} callback - Callback function
   * @returns {boolean} - Whether setup was successful
   */
  setupRealTimeUpdates(roomId, callback) {
    if (!this.initialized || !this.client) {
      logger.error('[MatrixMessageLoader] Cannot set up real-time updates: not initialized');
      return false;
    }

    if (!roomId) {
      logger.error('[MatrixMessageLoader] Cannot set up real-time updates: no roomId provided');
      return false;
    }

    if (!callback || typeof callback !== 'function') {
      logger.error('[MatrixMessageLoader] Cannot set up real-time updates: no callback provided');
      return false;
    }

    // Remove existing listener
    this.removeRealTimeUpdates(roomId);

    // Create a new listener
    const listener = (event, room) => {
      // Only process events for the specified room
      if (!room || room.roomId !== roomId) return;

      // Only process displayable events
      if (!this.isDisplayableEvent(event)) return;

      // Create a message from the event
      const message = this.createMessageFromEvent(event, room);

      // Call the callback
      callback(message);
    };

    // Add the listener
    this.client.on('Room.timeline', listener);

    // Store the listener
    this.roomListeners.set(roomId, listener);

    logger.info(`[MatrixMessageLoader] Set up real-time updates for room ${roomId}`);
    return true;
  }

  /**
   * Remove real-time updates for a room
   * @param {string} roomId - Room ID
   * @returns {boolean} - Whether removal was successful
   */
  removeRealTimeUpdates(roomId) {
    if (!this.initialized || !this.client) {
      logger.error('[MatrixMessageLoader] Cannot remove real-time updates: not initialized');
      return false;
    }

    if (!roomId) {
      logger.error('[MatrixMessageLoader] Cannot remove real-time updates: no roomId provided');
      return false;
    }

    // Get the listener
    const listener = this.roomListeners.get(roomId);
    if (!listener) {
      return false;
    }

    // Remove the listener
    this.client.removeListener('Room.timeline', listener);

    // Remove from the map
    this.roomListeners.delete(roomId);

    logger.info(`[MatrixMessageLoader] Removed real-time updates for room ${roomId}`);
    return true;
  }

  /**
   * Send a message to a room
   * @param {string} roomId - Room ID
   * @param {string|Object} content - Message content
   * @returns {Promise<Object>} - Sent event
   */
  async sendMessage(roomId, content) {
    if (!this.initialized || !this.client) {
      throw new Error('Cannot send message: not initialized');
    }

    if (!roomId) {
      throw new Error('Cannot send message: no roomId provided');
    }

    if (!content) {
      throw new Error('Cannot send message: no content provided');
    }

    try {
      // If content is a string, convert it to a content object
      const messageContent = typeof content === 'string' ? {
        msgtype: 'm.text',
        body: content
      } : content;

      // Send the message
      const result = await this.client.sendMessage(roomId, messageContent);

      logger.info(`[MatrixMessageLoader] Sent message to room ${roomId}`);
      return result;
    } catch (error) {
      logger.error('[MatrixMessageLoader] Error sending message:', error);
      throw error;
    }
  }
}

// Create a singleton instance
const matrixMessageLoader = new MatrixMessageLoader();

export default matrixMessageLoader;
