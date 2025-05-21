import api from '../utils/api';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

class MessageService {
  async fetchMessages(contactId, params = {}) {
    try {
      const response = await api.get(`/api/v1/whatsapp/contacts/${contactId}/messages`, {
        params: {
          limit: params.limit || 20,
          offset: (params.page || 0) * (params.limit || 20)
        }
      });

      if (!response.data || typeof response.data !== 'object') {
        throw new Error('Invalid response format');
      }

      return {
        messages: response.data.data.messages || response.data.messages || [],
        hasMore: (response.data.data.messages || response.data.messages || []).length === (params.limit || 20)
      };
    } catch (error) {
      logger.error('[MessageService] Error fetching messages:', error);
      throw error;
    }
  }

  async fetchNewMessages(contactId, lastEventId) {
    try {
      const response = await api.get(`/api/v1/whatsapp/contacts/${contactId}/newMessages`, {
        params: { lastEventId }
      });

      if (!response.data || typeof response.data !== 'object') {
        throw new Error('Invalid response format');
      }

      return {
        messages: response.data.data.messages || [],
        hasMore: false // New messages endpoint doesn't support pagination
      };
    } catch (error) {
      // Check if error is related to Matrix server
      if (error.response?.status === 500 && error.response?.data?.error?.includes('Matrix')) {
        logger.warn('[MessageService] Matrix server sync unavailable:', error);
        // Return empty messages array instead of throwing
        return {
          messages: [],
          hasMore: false,
          warning: 'Real-time sync unavailable. Please try again later.'
        };
      }
      
      logger.error('[MessageService] Error fetching new messages:', error);
      throw error;
    }
  }

  _createContentHash(content) {
    const str = JSON.stringify(content);
    let hash = 0;
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    
    return hash.toString(36) + str.length.toString(36);
  }

  normalizeMessage(message) {
    // Ensure we have valid timestamps
    const now = new Date().toISOString();
    const safeTimestamp = message.timestamp ? new Date(message.timestamp).toISOString() : now;
    const safeReceivedAt = message.received_at ? new Date(message.received_at).toISOString() : now;

    // Normalize content
    const normalizedContent = this._normalizeContent(message.content);
    
    // Create content hash
    const contentHash = this._createContentHash(normalizedContent);

    const baseMessage = {
      ...message,
      id: message.id || message.message_id || uuidv4(),
      message_id: message.message_id || message.id,
      received_at: safeReceivedAt,
      timestamp: safeTimestamp,
      content: normalizedContent,
      content_hash: contentHash
    };

    return baseMessage;
  }

  _normalizeContent(content) {
    if (!content) return '';
    
    // If content is a string that looks like JSON, try to parse it
    if (typeof content === 'string' && content.startsWith('{')) {
      try {
        const parsed = JSON.parse(content);
        return parsed.body || parsed.content || content;
      } catch {
        return content;
      }
    }
    
    // If content is an object with body property
    if (typeof content === 'object' && content.body) {
      return content.body;
    }
    
    // Otherwise return the content as is
    return content;
  }

  // async sendMessage(contactId, message) {
  //   try {
  //     const response = await api.post(
  //       `/api/whatsapp-entities/send-message/${contactId}`,
  //       message
  //     );

  //     if (response.data.status !== 'success') {
  //       throw new Error(response.data.message || 'Failed to send message');
  //     }

  //     return response.data;
  //   } catch (error) {
  //     logger.error('[MessageService] Error sending message:', error);
  //     throw error;
  //   }
  // }

  // async markMessagesAsRead(contactId, messageIds) {
  //   try {
  //     await api.post(`/api//contacts/${contactId}/messages/read`, {
  //       messageIds: Array.from(messageIds)
  //     });
  //     return true;
  //   } catch (error) {
  //     logger.error('[MessageService] Error marking messages as read:', error);
  //     throw error;
  //   }
  // }

  async refreshMessages(contactId) {
    try {
      const response = await api.get(`/api/v1/whatsapp/contacts/${contactId}/refreshMessages`);

      if (!response.data || typeof response.data !== 'object') {
        throw new Error('Invalid response format');
      }

      return {
        messages: response.data.data || [],
        metadata: response.data.metadata || { count: 0, timestamp: new Date().toISOString() }
      };
    } catch (error) {
      logger.error('[MessageService] Error refreshing messages:', error);
      throw error;
    }
  }
}

export const messageService = new MessageService(); 