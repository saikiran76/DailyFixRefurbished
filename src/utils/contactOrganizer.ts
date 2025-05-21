/**
 * Contact Organizer Utility
 *
 * This utility provides functions to organize contacts into categories
 * based on their nature and user interaction level.
 */

import logger from './logger';
import { TelegramEntityTypes } from './telegramEntityUtils';

/**
 * Contact Categories
 */
export const ContactCategories = {
  PRIORITY: 'priority',
  UNREAD: 'unread',
  MENTIONS: 'mentions',
  DIRECT_MESSAGES: 'direct_messages',
  BOTS: 'bots',
  GROUPS: 'groups',
  PRIVATE_GROUPS: 'private_groups',
  CHANNELS: 'channels',
  SUPERGROUPS: 'supergroups',
  MUTED: 'muted',
  ARCHIVED: 'archived',
};

/**
 * Organize contacts into categories
 * @param {Array} contacts - Array of contact objects
 * @param {Object} options - Organization options
 * @returns {Object} Organized contacts by category
 */
export const organizeContacts = (contacts, options = {}) => {
  if (!contacts || !Array.isArray(contacts)) {
    logger.warn('[ContactOrganizer] Invalid contacts array');
    return {};
  }

  const {
    pinnedContactIds = [],
    mutedContactIds = [],
    archivedContactIds = [],
    mentionKeywords = ['@me', '@all'],
    showMuted = true,
    showArchived = false,
  } = options;

  // Initialize categories
  const organizedContacts = {
    [ContactCategories.PRIORITY]: [],
    [ContactCategories.UNREAD]: [],
    [ContactCategories.MENTIONS]: [],
    [ContactCategories.DIRECT_MESSAGES]: [],
    [ContactCategories.BOTS]: [],
    [ContactCategories.GROUPS]: [],
    [ContactCategories.PRIVATE_GROUPS]: [],
    [ContactCategories.CHANNELS]: [],
    [ContactCategories.SUPERGROUPS]: [],
    [ContactCategories.MUTED]: [],
    [ContactCategories.ARCHIVED]: [],
  };

  // Process each contact
  contacts.forEach(contact => {
    // Skip if contact is archived and we're not showing archived
    if (archivedContactIds.includes(contact.id) && !showArchived) {
      return;
    }

    // Skip if contact is muted and we're not showing muted
    if (mutedContactIds.includes(contact.id) && !showMuted) {
      return;
    }

    // Add metadata to contact
    const enhancedContact = {
      ...contact,
      isPinned: pinnedContactIds.includes(contact.id),
      isMuted: mutedContactIds.includes(contact.id),
      isArchived: archivedContactIds.includes(contact.id),
    };

    // Categorize contact
    if (enhancedContact.isArchived) {
      organizedContacts[ContactCategories.ARCHIVED].push(enhancedContact);
      return;
    }

    if (enhancedContact.isMuted) {
      organizedContacts[ContactCategories.MUTED].push(enhancedContact);
      return;
    }

    // Check if contact is pinned (Priority Hub)
    if (enhancedContact.isPinned) {
      organizedContacts[ContactCategories.PRIORITY].push(enhancedContact);
      return;
    }

    // Check if contact has unread messages
    if (enhancedContact.unreadCount > 0) {
      organizedContacts[ContactCategories.UNREAD].push(enhancedContact);

      // Check if contact has mentions
      const hasMention = mentionKeywords.some(keyword =>
        enhancedContact.lastMessage && enhancedContact.lastMessage.includes(keyword)
      );

      if (hasMention) {
        organizedContacts[ContactCategories.MENTIONS].push(enhancedContact);
      }

      return;
    }

    // ULTRA-STRICT filtering of bridge bots and service rooms

    // Filter out the Telegram bridge bot completely - COMPREHENSIVE check
    if (enhancedContact.name === '@telegrambot:dfix-hsbridge.duckdns.org' ||
        enhancedContact.name === 'telegrambot' ||
        enhancedContact.name === 'Telegram Bridge Bot' ||
        enhancedContact.name.toLowerCase().includes('telegram bridge') ||
        enhancedContact.name.toLowerCase() === 'telegram' ||
        (enhancedContact.telegramContact && enhancedContact.telegramContact.username === 'telegrambot') ||
        enhancedContact.id === '@telegrambot:dfix-hsbridge.duckdns.org') {
      // Skip this contact entirely
      logger.debug('[ContactOrganizer] Filtering out Telegram bridge bot:', enhancedContact.name);
      return;
    }

    // Skip any contact with 'Telegram' as the exact name (likely the bridge bot)
    if ((enhancedContact.name === 'Telegram' || enhancedContact.name === 'telegram') &&
        (!enhancedContact.lastMessage || enhancedContact.members <= 2)) {
      // Skip this contact entirely
      logger.debug('[ContactOrganizer] Filtering out generic Telegram contact');
      return;
    }

    // Skip any contact with raw Matrix IDs as names
    if (enhancedContact.name &&
        (enhancedContact.name.includes('@telegram_') ||
         enhancedContact.name.includes(':dfix-hsbridge'))) {
      logger.debug('[ContactOrganizer] Filtering out contact with raw Matrix ID:', enhancedContact.name);
      return;
    }

    // Skip any service rooms
    if (enhancedContact.name &&
        (enhancedContact.name.includes('Bridge Status') ||
         enhancedContact.name.includes('Telegram Login') ||
         enhancedContact.name.includes('WhatsApp Login'))) {
      logger.debug('[ContactOrganizer] Filtering out service room:', enhancedContact.name);
      return;
    }

    // ULTRA-STRICT categorization by entity type
    // First, determine the actual entity type with high confidence
    let actualEntityType = enhancedContact.entityType;

    // If no entity type is set, determine it based on other properties - ULTRA-STRICT
    if (!actualEntityType || actualEntityType === TelegramEntityTypes.UNKNOWN) {
      // FIRST check if it's a group based on member count or explicit group flag
      if (enhancedContact.isGroup || enhancedContact.members > 2) {
        // If it's marked as a group or has more than 2 members, it's a group
        actualEntityType = TelegramEntityTypes.GROUP;
        logger.debug('[ContactOrganizer] Determined contact is a GROUP based on isGroup flag or member count:', enhancedContact.name);
      }
      // THEN check if it's a channel
      else if (enhancedContact.isChannel ||
                (enhancedContact.name && enhancedContact.name.toLowerCase().includes('channel'))) {
        // If it's marked as a channel or has 'channel' in the name, it's a channel
        actualEntityType = TelegramEntityTypes.CHANNEL;
        logger.debug('[ContactOrganizer] Determined contact is a CHANNEL:', enhancedContact.name);
      }
      // THEN check if it's a large group that should be a channel
      else if (enhancedContact.members > 50) {
        // If it has more than 50 members, it's likely a channel
        actualEntityType = TelegramEntityTypes.CHANNEL;
        logger.debug('[ContactOrganizer] Determined contact is a CHANNEL based on large member count:', enhancedContact.name);
      }
      // ONLY if none of the above, consider it a DM
      else if (enhancedContact.members <= 2 && !enhancedContact.isGroup) {
        // If it has 2 or fewer members and is not marked as a group, it's a DM
        actualEntityType = TelegramEntityTypes.DIRECT_MESSAGE;
        logger.debug('[ContactOrganizer] Determined contact is a DM based on member count:', enhancedContact.name);
      }
      // Default to GROUP for anything else
      else {
        actualEntityType = TelegramEntityTypes.GROUP;
        logger.debug('[ContactOrganizer] Default categorizing as GROUP:', enhancedContact.name);
      }
    }

    // Now categorize based on the determined entity type
    switch (actualEntityType) {
      case TelegramEntityTypes.DIRECT_MESSAGE:
        // ONLY put in DMs if it's ACTUALLY a DM
        logger.debug('[ContactOrganizer] Categorizing as DM:', enhancedContact.name);
        organizedContacts[ContactCategories.DIRECT_MESSAGES].push(enhancedContact);
        break;
      case TelegramEntityTypes.BOT:
        // ONLY put in BOTS if it's ACTUALLY a bot
        logger.debug('[ContactOrganizer] Categorizing as Bot:', enhancedContact.name);
        organizedContacts[ContactCategories.BOTS].push(enhancedContact);
        break;
      case TelegramEntityTypes.CHANNEL:
        // ONLY put in CHANNELS if it's ACTUALLY a channel
        logger.debug('[ContactOrganizer] Categorizing as Channel:', enhancedContact.name);
        organizedContacts[ContactCategories.CHANNELS].push(enhancedContact);
        break;
      case TelegramEntityTypes.SUPERGROUP:
        // ONLY put in SUPERGROUPS if it's ACTUALLY a supergroup
        logger.debug('[ContactOrganizer] Categorizing as Supergroup:', enhancedContact.name);
        organizedContacts[ContactCategories.SUPERGROUPS].push(enhancedContact);
        break;
      case TelegramEntityTypes.PRIVATE_GROUP:
        // ONLY put in PRIVATE_GROUPS if it's ACTUALLY a private group
        logger.debug('[ContactOrganizer] Categorizing as Private Group:', enhancedContact.name);
        organizedContacts[ContactCategories.PRIVATE_GROUPS].push(enhancedContact);
        break;
      case TelegramEntityTypes.PUBLIC_GROUP:
      case TelegramEntityTypes.GROUP:
        // ONLY put in GROUPS if it's ACTUALLY a group
        logger.debug('[ContactOrganizer] Categorizing as Group:', enhancedContact.name);
        organizedContacts[ContactCategories.GROUPS].push(enhancedContact);
        break;
      default:
        // For truly unknown types, make a best guess based on member count - ULTRA-STRICT
        // FIRST check if it's a group based on member count or explicit group flag
        if (enhancedContact.isGroup || enhancedContact.members > 2) {
          // If it's marked as a group or has more than 2 members, it's a group
          logger.debug('[ContactOrganizer] Fallback categorizing as GROUP based on isGroup flag or member count:', enhancedContact.name);
          organizedContacts[ContactCategories.GROUPS].push(enhancedContact);
        }
        // THEN check if it's a channel
        else if (enhancedContact.isChannel ||
                 (enhancedContact.name && enhancedContact.name.toLowerCase().includes('channel'))) {
          // If it's marked as a channel or has 'channel' in the name, it's a channel
          logger.debug('[ContactOrganizer] Fallback categorizing as CHANNEL:', enhancedContact.name);
          organizedContacts[ContactCategories.CHANNELS].push(enhancedContact);
        }
        // THEN check if it's a large group that should be a channel
        else if (enhancedContact.members > 50) {
          // If it has more than 50 members, it's likely a channel
          logger.debug('[ContactOrganizer] Fallback categorizing as CHANNEL based on large member count:', enhancedContact.name);
          organizedContacts[ContactCategories.CHANNELS].push(enhancedContact);
        }
        // ONLY if none of the above, consider it a DM
        else if (enhancedContact.members <= 2 && !enhancedContact.isGroup) {
          // If it has 2 or fewer members and is not marked as a group, it's a DM
          logger.debug('[ContactOrganizer] Fallback categorizing as DM based on member count:', enhancedContact.name);
          organizedContacts[ContactCategories.DIRECT_MESSAGES].push(enhancedContact);
        }
        // Default to GROUP for anything else
        else {
          logger.debug('[ContactOrganizer] Default fallback categorizing as GROUP:', enhancedContact.name);
          organizedContacts[ContactCategories.GROUPS].push(enhancedContact);
        }
    }
  });

  // Sort each category
  Object.keys(organizedContacts).forEach(category => {
    organizedContacts[category] = sortContacts(organizedContacts[category]);
  });

  return organizedContacts;
};

/**
 * Sort contacts by timestamp (most recent first)
 * @param {Array} contacts - Array of contact objects
 * @returns {Array} Sorted contacts
 */
export const sortContacts = (contacts) => {
  return [...contacts].sort((a, b) => {
    // First sort by pinned status
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;

    // Then sort by unread count
    if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
    if (a.unreadCount === 0 && b.unreadCount > 0) return 1;

    // Then sort by timestamp (most recent first)
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
};

/**
 * Get category display name
 * @param {string} category - Category key
 * @returns {string} Display name
 */
export const getCategoryDisplayName = (category) => {
  const displayNames = {
    [ContactCategories.PRIORITY]: 'Priority Hub',
    [ContactCategories.UNREAD]: 'Unread',
    [ContactCategories.MENTIONS]: 'Mentions',
    [ContactCategories.DIRECT_MESSAGES]: 'Direct Messages',
    [ContactCategories.BOTS]: 'Bots',
    [ContactCategories.GROUPS]: 'Groups',
    [ContactCategories.PRIVATE_GROUPS]: 'Private Groups',
    [ContactCategories.CHANNELS]: 'Channels',
    [ContactCategories.SUPERGROUPS]: 'Supergroups',
    [ContactCategories.MUTED]: 'Muted',
    [ContactCategories.ARCHIVED]: 'Archived',
  };

  return displayNames[category] || category;
};

/**
 * Get category icon name
 * @param {string} category - Category key
 * @returns {string} Icon name
 */
export const getCategoryIcon = (category) => {
  const icons = {
    [ContactCategories.PRIORITY]: 'star',
    [ContactCategories.UNREAD]: 'message-circle',
    [ContactCategories.MENTIONS]: 'at-sign',
    [ContactCategories.DIRECT_MESSAGES]: 'user',
    [ContactCategories.BOTS]: 'cpu',
    [ContactCategories.GROUPS]: 'users',
    [ContactCategories.PRIVATE_GROUPS]: 'lock',
    [ContactCategories.CHANNELS]: 'hash',
    [ContactCategories.SUPERGROUPS]: 'globe',
    [ContactCategories.MUTED]: 'volume-x',
    [ContactCategories.ARCHIVED]: 'archive',
  };

  return icons[category] || 'circle';
};

export default {
  organizeContacts,
  sortContacts,
  getCategoryDisplayName,
  getCategoryIcon,
  ContactCategories,
};
