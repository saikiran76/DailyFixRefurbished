import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';

// Base selectors
const selectOnboardingState = (state: RootState) => state.onboarding;
const selectContactsState = (state: RootState) => state.contacts;
const selectMessagesState = (state: RootState) => state.messages;
const selectAuthState = (state: RootState) => state.auth;

// Contact selectors
const selectAllContacts = (state: RootState) => state.contacts.items;
const selectContactPriority = (state: RootState, contactId: string | number) => 
  state.contacts.priorityMap[contactId]?.priority || 'low';

// Platform connection statistics
export const selectConnectedPlatforms = createSelector(
  [selectOnboardingState],
  (onboarding) => {
    const platforms = [];
    if (onboarding.whatsappConnected) platforms.push('whatsapp');
    if (onboarding.telegramConnected) platforms.push('telegram');
    return {
      count: platforms.length,
      platforms: platforms,
      details: [
        {
          id: 'whatsapp',
          name: 'WhatsApp',
          connected: onboarding.whatsappConnected,
          color: 'text-green-500',
          bgColor: 'bg-green-500/10'
        },
        {
          id: 'telegram', 
          name: 'Telegram',
          connected: onboarding.telegramConnected,
          color: 'text-blue-500',
          bgColor: 'bg-blue-500/10'
        }
      ]
    };
  }
);

// Contact statistics per platform
export const selectContactStats = createSelector(
  [selectAllContacts, selectConnectedPlatforms],
  (contacts, platformInfo) => {
    const whatsappContacts = contacts.filter(c => c.whatsapp_id);
    const telegramContacts = contacts.filter(c => c.telegram_id);
    
    return {
      total: contacts.length,
      whatsapp: whatsappContacts.length,
      telegram: telegramContacts.length,
      byPlatform: {
        whatsapp: {
          count: whatsappContacts.length,
          connected: platformInfo.platforms.includes('whatsapp')
        },
        telegram: {
          count: telegramContacts.length,
          connected: platformInfo.platforms.includes('telegram')
        }
      }
    };
  }
);

// Message statistics
export const selectMessageStats = createSelector(
  [selectMessagesState, selectContactsState],
  (messages, contacts) => {
    const messagesByContact = messages.items;
    let totalMessages = 0;
    let totalToday = 0;
    let totalThisWeek = 0;
    let activeConversations = 0;
    
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(today.setHours(0, 0, 0, 0));
    
    Object.values(messagesByContact).forEach((contactMessages: any[]) => {
      if (contactMessages && contactMessages.length > 0) {
        totalMessages += contactMessages.length;
        activeConversations += 1;
        
        // Count messages from today and this week
        contactMessages.forEach(msg => {
          const msgDate = new Date(msg.timestamp || msg.created_at);
          if (msgDate >= todayStart) {
            totalToday += 1;
          }
          if (msgDate >= weekAgo) {
            totalThisWeek += 1;
          }
        });
      }
    });
    
    return {
      total: totalMessages,
      today: totalToday,
      thisWeek: totalThisWeek,
      activeConversations,
      messagesReceived: Math.floor(totalThisWeek * 0.6), // Estimate
      messagesSent: Math.floor(totalThisWeek * 0.4), // Estimate
    };
  }
);

// Most active contacts
export const selectActiveContacts = createSelector(
  [selectAllContacts, selectMessagesState, selectContactsState],
  (contacts, messages, contactsState) => {
    const contactsWithActivity = contacts.map(contact => {
      const contactMessages = messages.items[contact.id] || [];
      const priority = contactsState.priorityMap[contact.id]?.priority || 'low';
      
      // Calculate activity score based on recent messages
      const now = Date.now();
      const dayInMs = 24 * 60 * 60 * 1000;
      
      let activityScore = 0;
      let lastMessageTime = 0;
      let unreadCount = 0;
      
      contactMessages.forEach(msg => {
        const messageTime = new Date(msg.timestamp || msg.created_at).getTime();
        const daysAgo = (now - messageTime) / dayInMs;
        
        // More recent messages have higher scores
        if (daysAgo <= 1) activityScore += 5;
        else if (daysAgo <= 3) activityScore += 3;
        else if (daysAgo <= 7) activityScore += 1;
        
        lastMessageTime = Math.max(lastMessageTime, messageTime);
        
        // Count unread messages (simplified)
        if (messages.unreadMessageIds.includes(msg.id)) {
          unreadCount += 1;
        }
      });
      
      return {
        id: contact.id,
        name: contact.display_name,
        platform: contact.whatsapp_id ? 'whatsapp' : 'telegram',
        avatar: contact.avatar_url,
        lastMessage: contact.last_message,
        lastMessageTime: lastMessageTime,
        messageCount: contactMessages.length,
        unreadCount,
        priority,
        activityScore
      };
    })
    .filter(contact => contact.activityScore > 0)
    .sort((a, b) => b.activityScore - a.activityScore)
    .slice(0, 8); // Top 8 most active
    
    return contactsWithActivity.map(contact => ({
      ...contact,
      lastMessageTime: contact.lastMessageTime 
        ? formatRelativeTime(contact.lastMessageTime)
        : 'No messages'
    }));
  }
);

// Weekly statistics
export const selectWeeklyStats = createSelector(
  [selectMessageStats, selectContactStats],
  (messageStats, contactStats) => {
    const lastWeekMessages = Math.floor(messageStats.thisWeek * 0.8); // Estimate last week
    const growth = lastWeekMessages > 0 
      ? ((messageStats.thisWeek - lastWeekMessages) / lastWeekMessages * 100).toFixed(1)
      : '0';
      
    return {
      messagesReceived: messageStats.messagesReceived,
      messagesSent: messageStats.messagesSent,
      newContacts: Math.floor(contactStats.total * 0.1), // Estimate new contacts
      activeConversations: messageStats.activeConversations,
      growth: `${growth}%`,
      trending: parseFloat(growth) > 0
    };
  }
);

// Dashboard summary
export const selectDashboardSummary = createSelector(
  [selectConnectedPlatforms, selectContactStats, selectMessageStats, selectActiveContacts, selectWeeklyStats],
  (platforms, contacts, messages, activeContacts, weekly) => ({
    platforms,
    contacts,
    messages,
    activeContacts,
    weekly,
    lastUpdated: new Date().toISOString()
  })
);

// Helper function for relative time formatting
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffInMs = now - timestamp;
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  
  if (diffInMinutes < 60) {
    return `${diffInMinutes} minutes ago`;
  } else if (diffInHours < 24) {
    return `${diffInHours} hours ago`;
  } else if (diffInDays < 7) {
    return `${diffInDays} days ago`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}

// Daily notes selector (localStorage based)
export const selectDailyNotes = createSelector(
  [selectActiveContacts],
  (activeContacts) => {
    const selectedContactId = localStorage.getItem('dashboard_selected_contact');
    const selectedContact = activeContacts.find(c => c.id.toString() === selectedContactId) || activeContacts[0];
    
    if (!selectedContact) {
      return {
        selectedContact: null,
        date: new Date().toLocaleDateString(),
        summary: 'No active contacts available.',
        keyPoints: [],
        nextAction: 'Connect to messaging platforms',
        priority: 'medium'
      };
    }
    
    // Get notes from localStorage
    const notesKey = `daily_notes_${selectedContact.id}`;
    const savedNotes = localStorage.getItem(notesKey);
    
    if (savedNotes) {
      try {
        return {
          selectedContact: selectedContact.name,
          ...JSON.parse(savedNotes)
        };
      } catch (e) {
        console.error('Error parsing saved notes:', e);
      }
    }
    
    // Default notes
    return {
      selectedContact: selectedContact.name,
      date: new Date().toLocaleDateString(),
      summary: `Recent activity with ${selectedContact.name}. ${selectedContact.messageCount} total messages exchanged.`,
      keyPoints: [
        `${selectedContact.messageCount} messages in conversation`,
        `Priority level: ${selectedContact.priority}`,
        `Platform: ${selectedContact.platform}`,
        selectedContact.unreadCount > 0 ? `${selectedContact.unreadCount} unread messages` : 'All messages read'
      ].filter(Boolean),
      nextAction: selectedContact.unreadCount > 0 ? 'Respond to unread messages' : 'Continue conversation',
      priority: selectedContact.priority
    };
  }
);

// Loading states
export const selectDashboardLoading = createSelector(
  [selectContactsState, selectMessagesState],
  (contacts, messages) => ({
    contacts: contacts.loading,
    messages: messages.loading,
    overall: contacts.loading || messages.loading
  })
);

// Error states  
export const selectDashboardErrors = createSelector(
  [selectContactsState, selectMessagesState],
  (contacts, messages) => ({
    contacts: contacts.error,
    messages: messages.error,
    hasErrors: !!(contacts.error || messages.error)
  })
); 