// Socket event names
export const SocketEvents = {
  // Connection events
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',
  RECONNECT: 'reconnect',
  RECONNECT_ATTEMPT: 'reconnect_attempt',
  RECONNECT_ERROR: 'reconnect_error',
  RECONNECT_FAILED: 'reconnect_failed',

  // Discord events
  DISCORD_SERVER_UPDATE: 'discord_server_update',
  DISCORD_SERVER_REMOVE: 'discord_server_remove',
  DISCORD_DM_UPDATE: 'discord_dm_update',
  DISCORD_CHANNEL_UPDATE: 'discord_channel_update',
  DISCORD_MESSAGE_UPDATE: 'discord_message_update',

  // Status events
  STATUS_UPDATE: 'status_update',
  RATE_LIMIT: 'rate_limit',
  ERROR: 'error',

  // Control events
  MESSAGE_PROCESSED: 'message_processed',
  BATCH_START: 'batch_start',
  BATCH_END: 'batch_end'
};

// Socket event schemas
export const EventSchemas = {
  [SocketEvents.DISCORD_SERVER_UPDATE]: {
    id: 'string',
    name: 'string',
    icon: 'string'
  },
  [SocketEvents.DISCORD_DM_UPDATE]: {
    id: 'string',
    recipients: 'object'
  },
  [SocketEvents.RATE_LIMIT]: {
    retryAfter: 'number',
    scope: 'string'
  },
  [SocketEvents.STATUS_UPDATE]: {
    status: 'string',
    message: 'string'
  }
};

// Validate socket event data
export const validateEventData = (eventName, data) => {
  const schema = EventSchemas[eventName];
  if (!schema) return true; // No schema defined means no validation needed

  if (!data || typeof data !== 'object') return false;

  for (const [key, type] of Object.entries(schema)) {
    if (!(key in data)) return false;
    if (typeof data[key] !== type) return false;
  }

  return true;
};

// Socket connection options
export const getConnectionOptions = (token, platform, userId) => ({
  auth: { 
    token,
    userId
  },
  query: { platform },
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 3,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  pingInterval: 10000,
  pingTimeout: 5000
});

// Event handler wrapper with validation and error handling
export const createEventHandler = (eventName, handler) => {
  return (data) => {
    try {
      // Validate event data
      if (!validateEventData(eventName, data)) {
        console.warn(`Invalid data received for event ${eventName}:`, data);
        return;
      }

      // Call handler with validated data
      handler(data);
    } catch (error) {
      console.error(`Error handling ${eventName} event:`, error);
    }
  };
};

// Batch processing helper
export const processBatch = async (socket, events, batchSize = 10) => {
  const results = [];
  const batches = [];

  // Split events into batches
  for (let i = 0; i < events.length; i += batchSize) {
    batches.push(events.slice(i, i + batchSize));
  }

  // Process each batch
  for (const batch of batches) {
    socket.emit(SocketEvents.BATCH_START, { size: batch.length });
    
    for (const event of batch) {
      try {
        const result = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Event processing timeout'));
          }, 5000);

          socket.emit(event.name, event.data, (response) => {
            clearTimeout(timeout);
            resolve(response);
          });
        });

        results.push({ success: true, event, result });
      } catch (error) {
        results.push({ success: false, event, error });
      }
    }

    socket.emit(SocketEvents.BATCH_END);
  }

  return results;
}; 