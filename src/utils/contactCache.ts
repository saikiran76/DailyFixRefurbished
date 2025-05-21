// contactCache.js - Lightweight contact caching utility
import logger from './logger';
import localforage from 'localforage';

/**
 * ContactCache - A utility for optimized caching of room summaries.
 * Provides multi-level caching (memory, localStorage, IndexedDB) for instant loading and background syncing.
 */
class ContactCache {
  constructor() {
    this._memoryCache = null;
    this._listeners = [];
    
    // Initialize localforage instance for contacts
    this._contactsStore = localforage.createInstance({
      name: 'contactsCache',
      storeName: 'contacts'
    });
    
    // Initialize localStorage key for timestamp
    this._lastSyncKey = 'contactCache_lastSync';
  }

  /**
   * Check if a room/contact is relevant and should be cached/displayed
   * @param {Object} contact - Contact object to check
   * @returns {boolean} Whether the contact is relevant
   * @private
   */
  _isRelevantContact(contact) {
    if (!contact || !contact.id) return false;
    
    // Filter out contacts with null, undefined or invalid properties
    if (!contact.name) return false;
    
    // CRITICAL: Filter out rooms with 'leave' or 'ban' states
    if (contact.roomState === 'leave' || contact.roomState === 'ban') {
      logger.info(`[ContactCache] Filtering out contact with state '${contact.roomState}': ${contact.id} - ${contact.name}`);
      return false;
    }
    
    // Filter out contacts with names containing specific terms
    const lowerName = (contact.name || '').toLowerCase();
    if (lowerName.includes('empty') || 
        lowerName.includes('bot') || 
        lowerName.includes('whatsapp') ||
        lowerName.includes('bridge bot') ||
        lowerName.includes('bridge status') ||
        lowerName.includes('welcome mat')) {
      return false;
    }
    
    // Filter out system rooms by name pattern
    if (lowerName.match(/^[0-9a-f-]{36}$/) || // UUID-style names
        lowerName.startsWith('!') ||           // Room IDs as names
        lowerName === 'telegram' ||            // Default room name
        lowerName === 'whatsapp') {           
      return false;
    }
    
    return true;
  }

  /**
   * Get contact summary data
   * @param {Object} room - Matrix room object 
   * @returns {Object} Contact summary object
   */
  getContactSummary(room) {
    if (!room || !room.roomId) {
      return null;
    }

    const lastEvent = room.timeline && room.timeline.length > 0
      ? room.timeline[room.timeline.length - 1]
      : null;

    const messagePreview = this._getLastMessagePreview(lastEvent);
    const timestamp = this._getLastTimestamp(lastEvent);

    return {
      id: room.roomId,
      userId: room.roomId,
      displayName: room.name || 'Unknown Contact',
      avatarUrl: room.avatarUrl || null,
      lastMessage: messagePreview,
      timestamp: timestamp,
      unreadCount: room.notificationCount || 0,
      isPinned: room.tags && room.tags['m.favourite'],
      isMuted: room.isMuted,
      isArchived: room.tags && room.tags['m.lowpriority'],
    };
  }

  /**
   * Get message preview text based on event type
   * @param {Object} event - Matrix event object
   * @returns {string} Preview text
   * @private
   */
  _getLastMessagePreview(event) {
    if (!event || !event.content) return "No messages";
    
    const { content, type } = event;
    
    switch (type) {
      case 'm.room.message':
        switch (content.msgtype) {
          case 'm.text':
            return content.body || "Message";
          case 'm.image':
            return "📷 Photo";
          case 'm.audio':
            return "🎵 Audio";
          case 'm.video':
            return "🎬 Video";
          case 'm.file':
            return "📎 File";
          default:
            return "Message";
        }
      case 'm.room.member':
        return "Member update";
      case 'm.call.invite':
        return "📞 Call";
      case 'm.reaction':
        return "Reaction";
      default:
        return "Activity";
    }
  }

  /**
   * Get timestamp from event
   * @param {Object} event - Matrix event object
   * @returns {number} Timestamp
   * @private
   */
  _getLastTimestamp(event) {
    return event && event.origin_server_ts 
      ? event.origin_server_ts 
      : Date.now();
  }

  /**
   * Sanitize contact objects to ensure they're serializable
   * @param {Array} contacts - Array of contact objects 
   * @returns {Array} Sanitized contacts array
   * @private
   */
  _sanitizeContactsForStorage(contacts) {
    if (!Array.isArray(contacts)) return [];
    
    return contacts
      .filter(contact => this._isRelevantContact(contact)) // Filter before sanitizing
      .map(contact => {
        if (!contact || typeof contact !== 'object') return null;
        
        // Create a new object with only the needed properties
        // to avoid circular references and non-serializable properties
        const safeContact = {
          id: contact.id || contact.userId || contact.roomId || null,
          name: contact.name || contact.displayName || 'Unknown',
          avatar: contact.avatar || contact.avatarUrl || null,
          lastMessage: contact.lastMessage || '',
          timestamp: contact.timestamp || Date.now(),
          unreadCount: contact.unreadCount || 0,
          isPinned: Boolean(contact.isPinned),
          isMuted: Boolean(contact.isMuted),
          isArchived: Boolean(contact.isArchived),
          isGroup: Boolean(contact.isGroup),
          isTelegram: Boolean(contact.isTelegram || contact.platform === 'telegram'),
          members: contact.members || 0
        };
        
        // Add telegramContact if available (with safe cloning)
        if (contact.telegramContact && typeof contact.telegramContact === 'object') {
          safeContact.telegramContact = {
            id: contact.telegramContact.id,
            username: contact.telegramContact.username,
            firstName: contact.telegramContact.firstName,
            lastName: contact.telegramContact.lastName,
            avatar: contact.telegramContact.avatar
          };
        }
        
        return safeContact;
      }).filter(Boolean); // Remove any null entries
  }

  /**
   * Cache contacts in memory, localStorage, and IndexedDB
   * @param {Array} contacts - Array of contact objects
   * @returns {Promise<void>}
   */
  async cacheContacts(contacts) {
    if (!Array.isArray(contacts)) {
      logger.error('Invalid contacts format for caching');
      return;
    }

    try {
      // Filter irrelevant contacts first
      const relevantContacts = contacts.filter(contact => this._isRelevantContact(contact));
      
      // Log if contacts were filtered out
      if (relevantContacts.length < contacts.length) {
        logger.info(`[ContactCache] Filtered out ${contacts.length - relevantContacts.length} irrelevant contacts`);
      }
      
      // Sanitize contacts to ensure they are serializable
      const sanitizedContacts = this._sanitizeContactsForStorage(relevantContacts);
      
      if (sanitizedContacts.length === 0) {
        logger.warn('No valid contacts to cache after sanitization');
        return;
      }
      
      // Update memory cache
      this._memoryCache = [...sanitizedContacts];
      
      // Update localStorage for quick access on next load
      try {
        localStorage.setItem('contactCache_data', JSON.stringify(sanitizedContacts));
      } catch (e) {
        logger.warn('Failed to cache contacts in localStorage:', e);
        // Continue despite localStorage error - we can still use memory and IndexedDB
      }
      
      // Update IndexedDB for persistent storage
      try {
        await this._contactsStore.setItem('contacts', sanitizedContacts);
      } catch (e) {
        logger.error('Failed to cache contacts in IndexedDB:', e);
        // If IndexedDB fails, we still have memory cache
      }
      
      // Update last sync timestamp
      const now = Date.now();
      localStorage.setItem(this._lastSyncKey, now.toString());
      
      // Notify listeners
      this._notifyListeners(sanitizedContacts);
      
      logger.info(`Cached ${sanitizedContacts.length} contacts successfully`);
    } catch (error) {
      logger.error('Error caching contacts:', error);
    }
  }
  
  /**
   * Get cached contacts, prioritizing in-memory cache, then localStorage, then IndexedDB
   * @returns {Promise<Array>} - Array of cached contacts
   */
  async getContacts() {
    try {
      // Try memory cache first (fastest)
      if (this._memoryCache) {
        // Filter out any irrelevant contacts that may have slipped through
        return this._memoryCache.filter(contact => this._isRelevantContact(contact));
      }
      
      // Try localStorage next (fast)
      try {
        const localStorageData = localStorage.getItem('contactCache_data');
        if (localStorageData) {
          const contacts = JSON.parse(localStorageData);
          // Filter out any irrelevant contacts
          const filteredContacts = contacts.filter(contact => this._isRelevantContact(contact));
          this._memoryCache = filteredContacts;
          return filteredContacts;
        }
      } catch (e) {
        logger.warn('Failed to retrieve contacts from localStorage:', e);
      }
      
      // Fall back to IndexedDB (slower but reliable)
      try {
        const contacts = await this._contactsStore.getItem('contacts');
        if (contacts) {
          // Filter out any irrelevant contacts
          const filteredContacts = contacts.filter(contact => this._isRelevantContact(contact));
          this._memoryCache = filteredContacts;
          return filteredContacts;
        }
      } catch (e) {
        logger.error('Failed to retrieve contacts from IndexedDB:', e);
      }
      
      // Return empty array if no cached data found
      return [];
    } catch (error) {
      logger.error('Error retrieving cached contacts:', error);
      return [];
    }
  }
  
  /**
   * Update a specific contact in the cache
   * @param {string} contactId - ID of the contact to update
   * @param {Object} updates - Object with properties to update
   * @returns {Promise<void>}
   */
  async updateContact(contactId, updates) {
    if (!contactId || !updates) {
      logger.error('Invalid parameters for updating contact');
      return;
    }

    try {
      // Get current cached contacts
      const contacts = await this.getContacts();
      
      // Sanitize updates to ensure they are serializable
      const sanitizedUpdates = this._sanitizeContactsForStorage([updates])[0];
      if (!sanitizedUpdates) {
        logger.error('Failed to sanitize contact updates');
        return;
      }
      
      // Find and update the contact
      const updatedContacts = contacts.map(contact => {
        if (contact.id === contactId) {
          const updatedContact = { ...contact };
          
          // Update each property from sanitized updates
          Object.entries(sanitizedUpdates).forEach(([key, value]) => {
            // Skip id property to avoid changing the contact's identity
            if (key === 'id') return;
            
            // Handle function updates (e.g., for counters)
            if (typeof value === 'function') {
              updatedContact[key] = value(contact[key]);
            } else {
              updatedContact[key] = value;
            }
          });
          
          return updatedContact;
        }
        return contact;
      });
      
      // Cache the updated contacts
      await this.cacheContacts(updatedContacts);
    } catch (error) {
      logger.error(`Error updating contact ${contactId}:`, error);
    }
  }
  
  /**
   * Merge new contacts with existing cached contacts
   * @param {Array} newContacts - Array of contact objects to merge
   * @returns {Promise<void>}
   */
  async mergeContacts(newContacts) {
    if (!Array.isArray(newContacts) || newContacts.length === 0) {
      return;
    }

    try {
      // Get current cached contacts
      const existingContacts = await this.getContacts();
      const existingMap = new Map(existingContacts.map(contact => [contact.id, contact]));
      
      // Sanitize new contacts to ensure they are serializable
      const sanitizedNewContacts = this._sanitizeContactsForStorage(newContacts);
      if (sanitizedNewContacts.length === 0) {
        logger.warn('No valid contacts to merge after sanitization');
        return;
      }
      
      // Merge new contacts, updating existing ones
      sanitizedNewContacts.forEach(newContact => {
        if (!newContact || !newContact.id) return;
        
        if (existingMap.has(newContact.id)) {
          // Update existing contact if the new one is more recent
          const existing = existingMap.get(newContact.id);
          
          // Prefer the newer timestamp
          if ((newContact.timestamp || 0) > (existing.timestamp || 0)) {
            existingMap.set(newContact.id, {
              ...existing,
              ...newContact,
              // Keep unread count from existing (don't reset it)
              unreadCount: Math.max(existing.unreadCount || 0, newContact.unreadCount || 0)
            });
          } else {
            // Keep existing but update some fields
            existingMap.set(newContact.id, {
              ...existing,
              // Only update specific fields from the new contact
              displayName: newContact.displayName || existing.displayName,
              avatarUrl: newContact.avatarUrl || existing.avatarUrl,
              // Keep unread count from existing (don't reset it)
              unreadCount: Math.max(existing.unreadCount || 0, newContact.unreadCount || 0)
            });
          }
        } else {
          // Add new contact
          existingMap.set(newContact.id, newContact);
        }
      });
      
      // Convert map back to array and cache
      const mergedContacts = Array.from(existingMap.values());
      await this.cacheContacts(mergedContacts);
      
      logger.info(`Merged ${sanitizedNewContacts.length} contacts with ${existingContacts.length} existing contacts`);
    } catch (error) {
      logger.error('Error merging contacts:', error);
    }
  }
  
  /**
   * Add a listener to be notified when contacts are updated
   * @param {Function} callback - Callback function that receives updated contacts
   */
  addListener(callback) {
    if (typeof callback !== 'function') return;
    
    this._listeners.push(callback);
  }
  
  /**
   * Notify all listeners of contact updates
   * @param {Array} contacts - Updated contacts array
   * @private
   */
  _notifyListeners(contacts) {
    this._listeners.forEach(listener => {
      try {
        listener(contacts);
      } catch (e) {
        logger.error('Error in contact cache listener:', e);
      }
    });
  }
  
  /**
   * Clear all cached data
   * @returns {Promise<void>}
   */
  async clearAllCaches() {
    try {
      // Clear memory cache
      this._memoryCache = null;
      
      // Clear localStorage
      localStorage.removeItem('contactCache_data');
      localStorage.removeItem(this._lastSyncKey);
      
      // Clear IndexedDB
      await this._contactsStore.clear();
      
      logger.info('All contact caches cleared');
    } catch (error) {
      logger.error('Error clearing contact caches:', error);
    }
  }
}

// Export singleton instance
export default new ContactCache(); 