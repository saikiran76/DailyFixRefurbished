import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit';
import { messageService } from '../../services/messageService';
import logger from '../../utils/logger';

// Async thunks
export const fetchMessages = createAsyncThunk(
  'messages/fetchAll',
  async ({ contactId, page = 0, limit = 20, platform = 'whatsapp' }, { rejectWithValue }) => {
    try {
      logger.info(`[Messages] Fetching ${platform} messages for contact:`, contactId);
      const result = await messageService.fetchMessages(contactId, { page, limit }, platform);
      logger.info(`[Messages] Fetched ${platform} messages:`, result.messages?.length);
      return result;
    } catch (error) {
      logger.error(`[Messages] Failed to fetch ${platform} messages:`, error);
      return rejectWithValue(error.message);
    }
  }
);

export const sendMessage = createAsyncThunk(
  'messages/send',
  async ({ contactId, message, platform = 'whatsapp' }, { rejectWithValue }) => {
    try {
      const result = await messageService.sendMessage(contactId, message, platform);
      return result;
    } catch (error) {
      logger.error(`[Messages] Failed to send ${platform} message:`, error);
      return rejectWithValue(error.message);
    }
  }
);

export const markMessagesAsRead = createAsyncThunk(
  'messages/markAsRead',
  async ({ contactId, messageIds, platform = 'whatsapp' }, { rejectWithValue }) => {
    try {
      await messageService.markMessagesAsRead(contactId, messageIds, platform);
      return { messageIds };
    } catch (error) {
      logger.error(`[Messages] Failed to mark ${platform} messages as read:`, error);
      return rejectWithValue(error.message);
    }
  }
);

export const fetchNewMessages = createAsyncThunk(
  'messages/fetchNew',
  async ({ contactId, lastEventId, platform = 'whatsapp' }, { rejectWithValue }) => {
    try {
      logger.info(`[Messages] Fetching new ${platform} messages for contact:`, { contactId, lastEventId });
      const result = await messageService.fetchNewMessages(contactId, lastEventId, platform);
      logger.info(`[Messages] Fetched new ${platform} messages:`, result.messages?.length);
      return result;
    } catch (error) {
      logger.error(`[Messages] Failed to fetch new ${platform} messages:`, error);
      return rejectWithValue(error.message);
    }
  }
);

export const refreshMessages = createAsyncThunk(
  'messages/refresh',
  async ({ contactId, platform = 'whatsapp' }, { rejectWithValue }) => {
    try {
      logger.info(`[Messages] Refreshing ${platform} messages for contact:`, contactId);
      const result = await messageService.refreshMessages(contactId, platform);
      logger.info(`[Messages] Refreshed ${platform} messages:`, result.messages?.length);
      return { contactId, ...result };
    } catch (error) {
      logger.error(`[Messages] Failed to refresh ${platform} messages:`, error);
      return rejectWithValue(error.message);
    }
  }
);

// Slice definition
const messageSlice = createSlice({
  name: 'messages',
  initialState: {
    items: {}, // Object instead of Map: { contactId: messages[] }
    loading: false,
    error: null,
    hasMore: true,
    currentPage: 0,
    messageQueue: [],
    unreadMessageIds: [], // Array instead of Set
    lastKnownMessageIds: {}, // Map of contactId to last message ID
    newMessagesFetching: false,
    newMessagesError: null,
    refreshing: false,
    refreshError: null
  },
  reducers: {
    clearMessages: (state) => {
      state.items = {};
      state.loading = false;
      state.error = null;
      state.hasMore = true;
      state.currentPage = 0;
    },
    clearAll: (state) => {
      return initialState;
    },
    addToMessageQueue: (state, action) => {
      state.messageQueue.push(action.payload);
    },
    removeFromMessageQueue: (state, action) => {
      state.messageQueue = state.messageQueue.filter(msg => msg.id !== action.payload);
    },
    updateMessageStatus: (state, action) => {
      const { contactId, messageId, status } = action.payload;
      const messages = state.items[contactId];
      if (messages) {
        const messageIndex = messages.findIndex(msg => msg.id === messageId);
        if (messageIndex !== -1) {
          messages[messageIndex].status = status;
        }
      }
    },
    messageReceived: (state, action) => {
      const { contactId, message } = action.payload;
      const normalized = messageService.normalizeMessage(message);

      if (!state.items[contactId]) {
        state.items[contactId] = [];
      }

      // Check for duplicates based on message_id only
      const exists = state.items[contactId].some(existingMsg => {
        // Check if it's the same message by ID (either message_id or id)
        return (existingMsg.message_id && normalized.message_id &&
                existingMsg.message_id === normalized.message_id) ||
               (existingMsg.id && normalized.id &&
                existingMsg.id === normalized.id);
      });

      if (!exists) {
        // Add message and maintain chronological order
        state.items[contactId] = [
          ...state.items[contactId],
          normalized
        ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        logger.debug('[Messages] New message added:', {
          id: normalized.id,
          message_id: normalized.message_id,
          content: normalized.content,
          timestamp: normalized.timestamp
        });
      } else {
        logger.debug('[Messages] Duplicate message detected:', {
          id: normalized.id,
          message_id: normalized.message_id,
          content: normalized.content,
          timestamp: normalized.timestamp
        });
      }
    },
    addToMessageQueue: (state, action) => {
      const newMessage = action.payload;
      const exists = state.messageQueue.some(m =>
        m.content === newMessage.content &&
        m.timestamp === newMessage.timestamp
      );

      if (!exists) {
        state.messageQueue.push({
          ...newMessage,
          tempId: uuidv4()
        });
      }
    },
    // CRITICAL FIX: Add reset action for global cleanup
    reset: () => initialState
  },
  extraReducers: (builder) => {
    builder
      // Fetch messages
      .addCase(fetchMessages.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchMessages.fulfilled, (state, action) => {
        const { messages, hasMore } = action.payload;
        const contactId = action.meta.arg.contactId;
        const page = action.meta.arg.page;

        // Normalize all messages
        const normalized = messages.map(msg => messageService.normalizeMessage(msg));

        // Check for duplicates using message_id only
        const uniqueMessages = normalized.filter(newMsg => {
          return !state.items[contactId]?.some(existingMsg =>
            (existingMsg.message_id && newMsg.message_id &&
             existingMsg.message_id === newMsg.message_id) ||
            (existingMsg.id && newMsg.id &&
             existingMsg.id === newMsg.id)
          );
        });

        state.items[contactId] = [
          ...(page === 0 ? [] : state.items[contactId] || []),
          ...uniqueMessages
        ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        state.hasMore = hasMore;
        state.currentPage = page;
        state.loading = false;
      })
      .addCase(fetchMessages.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Failed to fetch messages';
      })
      // Send message
      .addCase(sendMessage.fulfilled, (state, action) => {
        const contactId = action.meta.arg.contactId;
        const messages = state.items[contactId] || [];
        messages.push({
          ...action.meta.arg.message,
          id: action.payload.messageId,
          status: 'sent',
          timestamp: new Date().toISOString()
        });
        state.items[contactId] = messages;
      })
      // Mark as read
      .addCase(markMessagesAsRead.fulfilled, (state, action) => {
        const messageIds = action.payload.messageIds;
        state.unreadMessageIds = state.unreadMessageIds.filter(id => !messageIds.includes(id));
      })
      // Fetch new messages
      .addCase(fetchNewMessages.pending, (state) => {
        state.newMessagesFetching = true;
        state.newMessagesError = null;
      })
      .addCase(fetchNewMessages.fulfilled, (state, action) => {
        const { messages } = action.payload;
        const contactId = action.meta.arg.contactId;

        if (!messages || messages.length === 0) {
          state.newMessagesFetching = false;
          return;
        }

        // Use message_id for unique key generation
        const getMessageKey = (msg) => msg.message_id || msg.id;

        const existingKeys = new Set(
          (state.items[contactId] || []).map(getMessageKey)
        );

        const normalized = messages
          .map(messageService.normalizeMessage)
          .filter(msg => !existingKeys.has(getMessageKey(msg)));

        if (normalized.length > 0) {
          state.items[contactId] = [
            ...(state.items[contactId] || []),
            ...normalized
          ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

          // Update last known message ID
          const latestMessage = normalized[normalized.length - 1];
          state.lastKnownMessageIds[contactId] = latestMessage.id;

          logger.debug('[Messages] New messages added:', {
            count: normalized.length,
            messages: normalized.map(msg => ({
              id: msg.id,
              message_id: msg.message_id,
              content: msg.content,
              timestamp: msg.timestamp
            }))
          });
        }

        state.newMessagesFetching = false;
      })
      .addCase(fetchNewMessages.rejected, (state, action) => {
        state.newMessagesFetching = false;
        state.newMessagesError = action.payload || 'Failed to fetch new messages';
      })
      // Refresh messages
      .addCase(refreshMessages.pending, (state) => {
        state.refreshing = true;
        state.refreshError = null;
      })
      .addCase(refreshMessages.fulfilled, (state, action) => {
        const { contactId, messages } = action.payload;
        state.refreshing = false;

        if (!messages || !Array.isArray(messages)) return;

        // Use existing message normalization
        const normalized = messages.map(msg => messageService.normalizeMessage(msg))
          .filter(newMsg => !state.items[contactId]?.some(existingMsg =>
            (existingMsg.message_id && newMsg.message_id &&
             existingMsg.message_id === newMsg.message_id) ||
            (existingMsg.id && newMsg.id &&
             existingMsg.id === newMsg.id)
          ));

        if (normalized.length > 0) {
          state.items[contactId] = [
            ...(state.items[contactId] || []),
            ...normalized
          ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        }
      })
      .addCase(refreshMessages.rejected, (state, action) => {
        state.refreshing = false;
        state.refreshError = action.payload;
      });
  }
});

// Export actions
export const {
  clearMessages,
  clearAll,
  addToMessageQueue,
  removeFromMessageQueue,
  updateMessageStatus,
  messageReceived,
  reset
} = messageSlice.actions;

// Export reducer
export const messageReducer = messageSlice.reducer;

// Base selectors
const selectMessagesState = (state) => state.messages;
const selectMessagesItems = (state) => state.messages.items;
const selectContactId = (_, contactId) => contactId;

// Memoized selectors
export const selectMessages = createSelector(
  [selectMessagesItems, selectContactId],
  (items, contactId) => items[contactId] || []
);

export const selectMessageLoading = createSelector(
  [selectMessagesState],
  (messages) => messages.loading
);

export const selectMessageError = createSelector(
  [selectMessagesState],
  (messages) => messages.error
);

export const selectHasMoreMessages = createSelector(
  [selectMessagesState],
  (messages) => messages.hasMore
);

export const selectCurrentPage = createSelector(
  [selectMessagesState],
  (messages) => messages.currentPage
);

export const selectMessageQueue = createSelector(
  [selectMessagesState],
  (messages) => messages.messageQueue
);

export const selectUnreadMessageIds = createSelector(
  [selectMessagesState],
  (messages) => messages.unreadMessageIds
);

export const selectLastKnownMessageId = createSelector(
  [selectMessagesState, selectContactId],
  (messages, contactId) => messages.lastKnownMessageIds[contactId]
);

export const selectNewMessagesFetching = createSelector(
  [selectMessagesState],
  (messages) => messages.newMessagesFetching
);

export const selectNewMessagesError = createSelector(
  [selectMessagesState],
  (messages) => messages.newMessagesError
);

export const selectRefreshing = createSelector(
  [selectMessagesState],
  (messages) => messages.refreshing
);

export const selectRefreshError = createSelector(
  [selectMessagesState],
  (messages) => messages.refreshError
);