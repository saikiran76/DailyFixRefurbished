/**
 * Matrix Message Loader V2
 *
 * A completely rewritten, robust message loading utility based on Element-web's approach
 */
import logger from './logger';

class MatrixMessageLoaderV2 {
  constructor() {
    this.client = null;
    this.initialized = false;
    this.roomListeners = new Map();
    this.messageCache = new Map();
  }

  /**
   * Initialize the message loader with a Matrix client
   * @param {Object} client - Matrix client
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async initialize(client) {
    if (!client) {
      logger.error('[MatrixMessageLoaderV2] Cannot initialize: no client provided');
      return false;
    }

    this.client = client;
    this.initialized = true;
    logger.info('[MatrixMessageLoaderV2] Initialized');
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
      logger.error('[MatrixMessageLoaderV2] Cannot load messages: not initialized');
      return [];
    }

    if (!roomId) {
      logger.error('[MatrixMessageLoaderV2] Cannot load messages: no roomId provided');
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
        logger.error(`[MatrixMessageLoaderV2] Room not found: ${roomId}`);
        return [];
      }

      // Approach: Get ALL events from the timeline and paginate aggressively
      const messages = [];

      // 1. Get the timeline
      const timeline = room.getLiveTimeline();
      if (!timeline) {
        logger.error(`[MatrixMessageLoaderV2] Timeline not found for room ${roomId}`);
        return [];
      }

      // 2. Get initial events
      let events = timeline.getEvents();
      logger.info(`[MatrixMessageLoaderV2] Initial timeline has ${events.length} events`);

      // 3. Paginate EXTREMELY aggressively to get more events
      // We'll do multiple pagination attempts to ensure we get ALL messages
      const paginationAttempts = 10; // Increased from 5 to 10
      let lastEventCount = 0;
      let noChangeCount = 0;

      for (let i = 0; i < paginationAttempts; i++) {
        try {
          // Force a sync first
          if (i === 0) {
            try {
              // Try to get the absolute latest state
              await this.client.roomInitialSync(roomId, 200); // Increased from 100 to 200
              events = timeline.getEvents();
              logger.info(`[MatrixMessageLoaderV2] After initial sync: ${events.length} events`);

              // Add isLiveEvent function to events if it doesn't exist
              events.forEach(event => {
                if (typeof event.isLiveEvent !== 'function') {
                  event.isLiveEvent = () => false;
                }
              });
            } catch (syncError) {
              logger.warn(`[MatrixMessageLoaderV2] Error during room initial sync:`, syncError);
            }
          }

          // Paginate backwards to get more events
          const paginateResult = await this.client.paginateEventTimeline(timeline, {
            backwards: true,
            limit: 200 // Increased from 100 to 200
          });

          if (!paginateResult) {
            logger.info(`[MatrixMessageLoaderV2] No more events to paginate at attempt ${i+1}`);
            break;
          }

          // Get updated events
          events = timeline.getEvents();

          // Add isLiveEvent function to events if it doesn't exist
          events.forEach(event => {
            if (typeof event.isLiveEvent !== 'function') {
              event.isLiveEvent = () => false;
            }
          });

          logger.info(`[MatrixMessageLoaderV2] After pagination attempt ${i+1}: ${events.length} events`);

          // Check if we're still getting new events
          if (events.length === lastEventCount) {
            noChangeCount++;

            // If we've had 3 attempts with no new events, we're probably done
            if (noChangeCount >= 3) {
              logger.info(`[MatrixMessageLoaderV2] No new events after ${noChangeCount} attempts, stopping pagination`);
              break;
            }
          } else {
            // Reset the no change counter if we got new events
            noChangeCount = 0;
            lastEventCount = events.length;
          }

          // If we have a LOT of events, stop paginating
          if (events.length >= limit * 5) { // Increased from 2x to 5x
            logger.info(`[MatrixMessageLoaderV2] Reached very high event count (${events.length}), stopping pagination`);
            break;
          }

          // Small delay to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (paginationError) {
          logger.warn(`[MatrixMessageLoaderV2] Error during pagination attempt ${i+1}:`, paginationError);
          // Continue to next attempt after a short delay
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // 4. Process events into messages
      // Create a set to track processed event IDs to avoid duplicates
      const processedEventIds = new Set();

      // Process all events
      for (const event of events) {
        try {
          // Skip if not a displayable event
          if (!this.isDisplayableEvent(event)) {
            continue;
          }

          // Get event ID
          const eventId = typeof event.getId === 'function' ? event.getId() :
                         (event.event_id || event.id);

          // Skip if already processed or no ID
          if (!eventId || processedEventIds.has(eventId)) {
            continue;
          }

          // Mark as processed
          processedEventIds.add(eventId);

          // Create message object
          const message = this.createMessageFromEvent(event, room);
          messages.push(message);
        } catch (eventError) {
          logger.warn(`[MatrixMessageLoaderV2] Error processing event:`, eventError);
          // Continue to next event
        }
      }

      // 5. Sort messages by timestamp
      messages.sort((a, b) => a.timestamp - b.timestamp);

      logger.info(`[MatrixMessageLoaderV2] Successfully loaded ${messages.length} messages`);
      return messages;
    } catch (error) {
      logger.error('[MatrixMessageLoaderV2] Error loading messages:', error);
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

      // Check if it's a displayable event type - be more inclusive
      const displayableTypes = [
        'm.room.message',
        'm.room.encrypted',
        'm.sticker',
        'm.room.member', // Include member events (join/leave)
        'm.reaction',    // Include reactions
        'm.room.name',   // Include room name changes
        'm.room.topic'   // Include topic changes
      ];

      if (!displayableTypes.includes(eventType)) {
        return false;
      }

      // Get content
      const content = typeof event.getContent === 'function' ? event.getContent() :
                     event.content || (event.event && event.event.content) || {};

      // For message events, be more lenient
      if (eventType === 'm.room.message') {
        // Accept any message with content, even if it doesn't have a body or msgtype
        return !!content;
      }

      // For member events, only show join/leave/invite
      if (eventType === 'm.room.member') {
        const membership = content.membership;
        return membership === 'join' || membership === 'leave' || membership === 'invite';
      }

      // For other event types, just check if there's content
      return !!content;
    } catch (error) {
      logger.warn('[MatrixMessageLoaderV2] Error checking if event is displayable:', error);
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

      // Get event type
      const eventType = typeof event.getType === 'function' ? event.getType() :
                       event.type || (event.event && event.event.type);

      // Get message body based on event type
      let body = '';
      let eventTypeLabel = '';

      // Handle different event types
      if (eventType === 'm.room.message') {
        body = content.body || '';

        // If no body, try to create a fallback based on msgtype
        if (!body && content.msgtype) {
          if (content.msgtype === 'm.image') {
            body = 'Image';
            eventTypeLabel = 'image';
          } else if (content.msgtype === 'm.file') {
            body = 'File';
            eventTypeLabel = 'file';
          } else if (content.msgtype === 'm.audio') {
            body = 'Audio';
            eventTypeLabel = 'audio';
          } else if (content.msgtype === 'm.video') {
            body = 'Video';
            eventTypeLabel = 'video';
          } else {
            body = 'Message';
          }
        }
      } else if (eventType === 'm.room.encrypted') {
        body = 'Encrypted message';
        eventTypeLabel = 'encrypted';
      } else if (eventType === 'm.sticker') {
        body = 'Sticker';
        eventTypeLabel = 'sticker';
      } else if (eventType === 'm.room.member') {
        const membership = content.membership;
        const targetName = content.displayname || senderId;

        if (membership === 'join') {
          body = `${targetName} joined the room`;
          eventTypeLabel = 'member_join';
        } else if (membership === 'leave') {
          body = `${targetName} left the room`;
          eventTypeLabel = 'member_leave';
        } else if (membership === 'invite') {
          body = `${targetName} was invited to the room`;
          eventTypeLabel = 'member_invite';
        }
      } else if (eventType === 'm.reaction') {
        body = `Reacted with ${content['m.relates_to']?.key || '👍'}`;
        eventTypeLabel = 'reaction';
      } else if (eventType === 'm.room.name') {
        body = `Room name changed to: ${content.name || 'Unknown'}`;
        eventTypeLabel = 'room_name';
      } else if (eventType === 'm.room.topic') {
        body = `Room topic changed to: ${content.topic || 'Unknown'}`;
        eventTypeLabel = 'room_topic';
      } else {
        // Default fallback
        body = 'Message';
      }

      // Get timestamp
      const timestamp = typeof event.getOriginServerTs === 'function' ? event.getOriginServerTs() :
                       event.origin_server_ts || event.timestamp ||
                       (event.event && event.event.origin_server_ts) || Date.now();

      // Check if the message is from the current user
      const isFromMe = this.client && senderId === this.client.getUserId();

      // Create message object with additional fields
      return {
        id,
        sender: senderId,
        senderName,
        body,
        timestamp,
        isFromMe,
        rawEvent: event,
        content,
        eventType,
        eventTypeLabel
      };
    } catch (error) {
      logger.warn('[MatrixMessageLoaderV2] Error creating message from event:', error);

      // Return a fallback message
      return {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        sender: 'Unknown',
        senderName: 'Unknown',
        body: 'Error processing message',
        timestamp: Date.now(),
        isFromMe: false,
        rawEvent: event,
        content: {},
        eventType: 'unknown',
        eventTypeLabel: 'error'
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
      logger.error('[MatrixMessageLoaderV2] Cannot get parent event: not initialized');
      return null;
    }

    if (!roomId || !eventId) {
      logger.error('[MatrixMessageLoaderV2] Cannot get parent event: missing roomId or eventId');
      return null;
    }

    try {
      // Get the room
      const room = this.client.getRoom(roomId);
      if (!room) {
        logger.error(`[MatrixMessageLoaderV2] Room not found: ${roomId}`);
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
          return event;
        }
      }

      // If we couldn't find the event, try to paginate to get more events
      try {
        // Paginate backwards to get more events
        const paginateResult = await this.client.paginateEventTimeline(timeline, {
          backwards: true,
          limit: 100 // Request more events
        });

        if (paginateResult) {
          // Try again with the updated timeline
          const events = timeline.getEvents();
          const event = events.find(e => {
            const id = typeof e.getId === 'function' ? e.getId() : e.event_id || e.id;
            return id === eventId;
          });

          if (event) {
            return event;
          }
        }
      } catch (paginationError) {
        logger.warn(`[MatrixMessageLoaderV2] Error paginating timeline for parent event:`, paginationError);
      }

      logger.warn(`[MatrixMessageLoaderV2] Could not find parent event: ${eventId}`);
      return null;
    } catch (error) {
      logger.error('[MatrixMessageLoaderV2] Error getting parent event:', error);
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
      logger.error('[MatrixMessageLoaderV2] Cannot set up real-time updates: not initialized');
      return false;
    }

    if (!roomId) {
      logger.error('[MatrixMessageLoaderV2] Cannot set up real-time updates: no roomId provided');
      return false;
    }

    if (!callback || typeof callback !== 'function') {
      logger.error('[MatrixMessageLoaderV2] Cannot set up real-time updates: no callback provided');
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

    logger.info(`[MatrixMessageLoaderV2] Set up real-time updates for room ${roomId}`);
    return true;
  }

  /**
   * Remove real-time updates for a room
   * @param {string} roomId - Room ID
   * @returns {boolean} - Whether removal was successful
   */
  removeRealTimeUpdates(roomId) {
    if (!this.initialized || !this.client) {
      logger.error('[MatrixMessageLoaderV2] Cannot remove real-time updates: not initialized');
      return false;
    }

    if (!roomId) {
      logger.error('[MatrixMessageLoaderV2] Cannot remove real-time updates: no roomId provided');
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

    logger.info(`[MatrixMessageLoaderV2] Removed real-time updates for room ${roomId}`);
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
      const result = await this.client.sendEvent(roomId, 'm.room.message', messageContent);

      logger.info(`[MatrixMessageLoaderV2] Sent message to room ${roomId}`);
      return result;
    } catch (error) {
      logger.error('[MatrixMessageLoaderV2] Error sending message:', error);
      throw error;
    }
  }
}

// Create a singleton instance
const matrixMessageLoaderV2 = new MatrixMessageLoaderV2();

export default matrixMessageLoaderV2;
