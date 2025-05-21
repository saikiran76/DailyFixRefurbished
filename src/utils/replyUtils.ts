/**
 * Utility functions for handling message replies
 */
import logger from './logger';

/**
 * Get the parent event ID from a message (the message being replied to)
 * @param {Object} event - Matrix event
 * @returns {string|undefined} - Event ID of the parent message, if any
 */
export function getParentEventId(event) {
  if (!event) return undefined;

  try {
    // Check if the event has a replyEventId property (added by our code)
    if (event.replyEventId) {
      return event.replyEventId;
    }

    // Check for m.in_reply_to relation
    const content = event.getContent ? event.getContent() : event.content;
    if (content && content['m.relates_to'] && content['m.relates_to']['m.in_reply_to']) {
      return content['m.relates_to']['m.in_reply_to'].event_id;
    }

    // Check for legacy reply format
    if (content && content.body && content.body.startsWith('> <')) {
      // Try to extract the event ID from the fallback format
      const match = content.body.match(/^> <.*?> .*?\n\n/s);
      if (match) {
        // This is a fallback format, but we don't have the event ID
        // We'll return a special value to indicate this
        return 'fallback_format';
      }
    }
  } catch (error) {
    logger.warn('[replyUtils] Error getting parent event ID:', error);
  }

  return undefined;
}

/**
 * Check if an event is a reply to another event
 * @param {Object} event - Matrix event
 * @returns {boolean} - Whether the event is a reply
 */
export function isReply(event) {
  return !!getParentEventId(event);
}

/**
 * Add reply information to a message content
 * @param {Object} content - Message content
 * @param {Object} replyToEvent - Event being replied to
 */
export function addReplyToMessageContent(content, replyToEvent) {
  if (!content || !replyToEvent) return;

  try {
    // Add m.relates_to with m.in_reply_to
    content['m.relates_to'] = {
      ...(content['m.relates_to'] || {}),
      'm.in_reply_to': {
        event_id: replyToEvent.getId ? replyToEvent.getId() : replyToEvent.event_id,
      },
    };

    // Add fallback body format for clients that don't support m.in_reply_to
    const originalBody = content.body || '';
    const replyToSender = replyToEvent.getSender ? replyToEvent.getSender() : replyToEvent.sender;
    const replyToContent = replyToEvent.getContent ? replyToEvent.getContent() : replyToEvent.content;
    const replyToBody = replyToContent.body || '';

    // Get a better display name if possible
    let displayName = replyToSender;

    // For Telegram users, try to get a better name
    if (replyToSender && replyToSender.includes('telegram_')) {
      // Check if we have sender_name in the content
      if (replyToContent && replyToContent.sender_name) {
        displayName = replyToContent.sender_name;
      } else {
        // Use a more user-friendly format
        displayName = getDisplayNameFromUserId(replyToSender);
      }
    }

    // Format the fallback text - but don't include the raw Matrix ID
    const fallbackLines = replyToBody.split('\n').map(line => `> ${line}`);
    content.body = `${originalBody}`;
  } catch (error) {
    logger.warn('[replyUtils] Error adding reply to message content:', error);
  }
}

/**
 * Strip the reply fallback from a message body
 * @param {string} body - Message body
 * @returns {string} - Message body without the reply fallback
 */
export function stripPlainReply(body) {
  if (!body) return '';

  try {
    // Removes lines beginning with `> ` until you reach one that doesn't
    const lines = body.split('\n');
    while (lines.length && lines[0].startsWith('> ')) lines.shift();
    // Reply fallback has a blank line after it, so remove it to prevent leading newline
    if (lines[0] === '') lines.shift();
    return lines.join('\n');
  } catch (error) {
    logger.warn('[replyUtils] Error stripping plain reply:', error);
    return body;
  }
}

/**
 * Get a user-friendly display name from a Matrix ID
 * @param {string} userId - Matrix user ID
 * @returns {string} - Display name
 */
export function getDisplayNameFromUserId(userId) {
  if (!userId) return 'Unknown User';

  try {
    // For Telegram users, the format is usually @telegram_123456789:server.org
    if (userId.includes('telegram_')) {
      // Try to extract a more user-friendly name
      const telegramId = userId.split('telegram_')[1]?.split(':')[0];
      if (telegramId) {
        return `User ${telegramId}`;
      }
    }

    // For other users, just use the first part of the Matrix ID
    return userId.split(':')[0].replace('@', '');
  } catch (error) {
    logger.warn('[replyUtils] Error getting display name from user ID:', error);
    return 'Unknown User';
  }
}
