/**
 * Telegram Entity Utilities
 *
 * This utility provides functions to identify and categorize Telegram entities
 * such as groups, channels, and direct messages.
 */

import logger from './logger';

/**
 * Telegram Entity Types
 */
export const TelegramEntityTypes = {
  DIRECT_MESSAGE: 'direct_message',
  GROUP: 'group',
  CHANNEL: 'channel',
  SUPERGROUP: 'supergroup',
  BOT: 'bot',
  PRIVATE_GROUP: 'private_group', // User can't send messages
  PUBLIC_GROUP: 'public_group',   // User can send messages
  UNKNOWN: 'unknown'
};

/**
 * Identify the type of Telegram entity based on room properties
 * @param {Object} room - Matrix room object
 * @param {Object} client - Matrix client
 * @returns {Object} Entity type information
 */
export const identifyTelegramEntityType = (room, client) => {
  if (!room) {
    return {
      type: TelegramEntityTypes.UNKNOWN,
      canSendMessages: false
    };
  }

  try {
    // Handle case where client is not defined
    if (!client) {
      logger.warn('[TelegramEntityUtils] Client not defined when identifying entity type');
      return {
        type: TelegramEntityTypes.UNKNOWN,
        canSendMessages: false,
        isGroup: false,
        isChannel: false,
        isPrivate: false,
        isBot: false
      };
    }

    const userId = client.getUserId();
    const roomId = room.roomId;
    const roomName = room.name || '';
    const roomMembers = room.getJoinedMembers() || [];
    const memberCount = roomMembers.length;
    const powerLevels = room.currentState?.getStateEvents('m.room.power_levels', '');
    const powerLevelsContent = powerLevels ? powerLevels.getContent() : {};
    const userPowerLevel = powerLevelsContent.users?.[userId] || 0;
    const sendMessagePowerLevel = powerLevelsContent.events?.['m.room.message'] || 0;
    const canSendMessages = userPowerLevel >= sendMessagePowerLevel;

    // Get all members except the current user and the Telegram bot
    const otherMembers = roomMembers.filter(member =>
      member.userId !== userId &&
      !member.userId.includes('telegrambot:')
    );

    // Check if this is a direct message with a Telegram user
    const telegramMembers = roomMembers.filter(member =>
      member.userId.includes('@telegram_')
    );
    const hasTelegramSenders = telegramMembers.length > 0;

    // Check if this is the Telegram bridge bot - COMPREHENSIVE check
    const isTelegramBridgeBot = roomMembers.some(member =>
      member.userId === '@telegrambot:dfix-hsbridge.duckdns.org' ||
      member.name === 'telegram bridge bot' ||
      member.name.toLowerCase().includes('telegram bridge') ||
      (member.name.toLowerCase() === 'telegram' && roomMembers.length <= 2)
    ) ||
    roomName === 'telegram bridge bot' ||
    roomName.toLowerCase().includes('telegram bridge') ||
    (roomName.toLowerCase() === 'telegram' && roomMembers.length <= 2);

    if (isTelegramBridgeBot) {
      logger.debug(`[TelegramEntityUtils] Identified room ${roomId} as Telegram Bridge Bot room - will be filtered out`);
    }

    // Check if this is a bot conversation (but not the bridge bot itself)
    const isBot = (roomName.toLowerCase().includes('bot') && memberCount <= 3) ||
                 (telegramMembers.length === 1 && telegramMembers[0].name && telegramMembers[0].name.toLowerCase().includes('bot'));

    // Determine if this is a channel based on various indicators
    const isChannel =
      roomName.toLowerCase().includes('channel') ||
      (memberCount > 50) ||
      (powerLevelsContent.events?.['m.room.message'] > 0 && memberCount > 10);

    // Determine if this is a supergroup
    const isSupergroup =
      roomName.toLowerCase().includes('supergroup') ||
      (memberCount > 200);

    // Determine if this is a group - ULTRA-STRICT definition
    const isGroup =
      // More than 2 members total is definitely a group
      (roomMembers.length > 2) ||
      // More than 1 other member besides the current user is a group
      (otherMembers.length > 1) ||
      // Room name contains 'group' but not 'channel'
      (roomName.toLowerCase().includes('group') && !roomName.toLowerCase().includes('channel')) ||
      // Room topic contains 'group chat' or similar
      (room.currentState?.getStateEvents('m.room.topic')?.length > 0 &&
       room.currentState.getStateEvents('m.room.topic')[0].getContent().topic?.toLowerCase().includes('group'));

    // Determine entity type
    let entityType = TelegramEntityTypes.UNKNOWN;

    // Filter out the Telegram bridge bot completely
    if (isTelegramBridgeBot && roomMembers.length <= 2) {
      // This is just the bridge bot room - ignore it completely
      entityType = TelegramEntityTypes.UNKNOWN;
    }
    // Strict bot detection
    else if (isBot && !isTelegramBridgeBot) {
      entityType = TelegramEntityTypes.BOT;
    }
    // Strict channel detection
    else if (isChannel) {
      entityType = TelegramEntityTypes.CHANNEL;
    }
    // Strict supergroup detection
    else if (isSupergroup) {
      entityType = TelegramEntityTypes.SUPERGROUP;
    }
    // Strict group detection
    else if (isGroup) {
      if (canSendMessages) {
        entityType = TelegramEntityTypes.PUBLIC_GROUP;
      } else {
        entityType = TelegramEntityTypes.PRIVATE_GROUP;
      }
    }
    // ULTRA-Strict DM detection - MUST have exactly one Telegram user and no other members except current user
    // AND must not be a group or channel or supergroup
    else if (hasTelegramSenders &&
             telegramMembers.length === 1 &&
             otherMembers.length === 1 &&
             roomMembers.length <= 2 &&
             !isGroup &&
             !isChannel &&
             !isSupergroup) {
      entityType = TelegramEntityTypes.DIRECT_MESSAGE;
      logger.debug(`[TelegramEntityUtils] Identified room ${roomId} as DIRECT_MESSAGE - strict criteria met`);
    }

    logger.debug(`[TelegramEntityUtils] Identified room ${roomId} as ${entityType}`, {
      roomName,
      memberCount,
      canSendMessages,
      userPowerLevel,
      sendMessagePowerLevel
    });

    return {
      type: entityType,
      canSendMessages,
      memberCount,
      userPowerLevel,
      sendMessagePowerLevel,
      isGroup: isGroup || isSupergroup,
      isChannel: isChannel,
      isPrivate: !canSendMessages,
      isBot: isBot
    };
  } catch (error) {
    logger.error('[TelegramEntityUtils] Error identifying entity type:', error);
    return {
      type: TelegramEntityTypes.UNKNOWN,
      canSendMessages: false,
      error: error.message
    };
  }
};

/**
 * Extract Telegram username from a Matrix user ID
 * @param {string} userId - Matrix user ID
 * @returns {string|null} Telegram username or null
 */
export const extractTelegramUsername = (userId) => {
  if (!userId) return null;

  // Check for Telegram user ID pattern
  const telegramIdMatch = userId.match(/@telegram_(\d+):/);
  if (telegramIdMatch) {
    return telegramIdMatch[1];
  }

  return null;
};

/**
 * Get entity type display name
 * @param {string} entityType - Entity type
 * @returns {string} Display name
 */
export const getEntityTypeDisplayName = (entityType) => {
  const displayNames = {
    [TelegramEntityTypes.DIRECT_MESSAGE]: 'Direct Message',
    [TelegramEntityTypes.GROUP]: 'Group',
    [TelegramEntityTypes.CHANNEL]: 'Channel',
    [TelegramEntityTypes.SUPERGROUP]: 'Supergroup',
    [TelegramEntityTypes.BOT]: 'Bot',
    [TelegramEntityTypes.PRIVATE_GROUP]: 'Private Group',
    [TelegramEntityTypes.PUBLIC_GROUP]: 'Group',
    [TelegramEntityTypes.UNKNOWN]: 'Unknown'
  };

  return displayNames[entityType] || entityType;
};

export default {
  identifyTelegramEntityType,
  extractTelegramUsername,
  getEntityTypeDisplayName,
  TelegramEntityTypes
};
