import { createSlice, createAsyncThunk, createAction } from '@reduxjs/toolkit';
import { contactService } from '../../services/contactService';
import logger from '../../utils/logger';

// Add priority constants
export const PRIORITY_LEVELS = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

// Async thunks
export const fetchContacts = createAsyncThunk(
  'contacts/fetchAll',
  async (userId, { rejectWithValue }) => {
    try {
      logger.info('[Contacts] Fetching contacts for user:', userId);
      const result = await contactService.getCurrentUserContacts(userId);
      
      // Handle server-reported sync state
      const syncInfo = result.meta?.sync_info || {
        last_sync: null,
        is_syncing: false
      };
      
      logger.info('[Contacts] Server sync state:', syncInfo);
      
      return {
        contacts: result.data || [],
        meta: {
          sync_info: syncInfo
        }
      };
    } catch (error) {
      logger.info('[Contacts] Failed to fetch contacts:', error);
      return rejectWithValue(error.message);
    }
  }
);

// freshSync Thunk
export const freshSyncContacts = createAsyncThunk(
  'contacts/freshSync',
  async (_, { rejectWithValue }) => {
    try {
      const result = await contactService.performFreshSync();
      return result;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const syncContact = createAsyncThunk(
  'contacts/sync',
  async (contactId, { rejectWithValue }) => {
    try {
      const result = await contactService.syncContact(contactId);
      return result;
    } catch (error) {
      logger.info('[ContactSlice] Failed to sync contact:', error);
      return rejectWithValue(error.message);
    }
  }
);

// export const updateContactStatus = createAsyncThunk(
//   'contacts/updateStatus',
//   async ({ contactId, status }, { rejectWithValue }) => {
//     try {
//       const result = await contactService.updateContactStatus(contactId, status);
//       return result;
//     } catch (error) {
//       logger.info('[ContactSlice] Failed to update contact status:', error);
//       return rejectWithValue(error.message);
//     }
//   }
// );

// Add new action for updating priority
export const updateContactPriority = createAsyncThunk(
  'contacts/updatePriority',
  async ({ contactId, priority }, { rejectWithValue, getState }) => {
    try {
      const contact = getState().contacts.items.find(c => c.id === contactId);
      if (!contact) {
        throw new Error('Contact not found');
      }

      // Return the priority update
      return { contactId, priority, timestamp: Date.now() };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

// Add new action
export const setSyncProgressState = createAction('contacts/setSyncProgressState');

// Slice definition
const initialState = {
  items: [],
  loading: false,
  error: null,
  syncStatus: {
    inProgress: false,
    lastSyncTime: null,
    error: null
  },
  initialLoadComplete: false,
  priorityMap: {} // New field for storing priorities
};

const contactSlice = createSlice({
  name: 'contacts',
  initialState,
  reducers: {
    clearContactError: (state) => {
      state.error = null;
      state.syncStatus.error = null;
    },
    clearContacts: (state) => {
      state.items = [];
      state.loading = false;
      state.error = null;
      state.syncStatus = {
        inProgress: false,
        lastSyncTime: null,
        error: null
      };
      state.initialLoadComplete = false;
    },
    updateContactMembership: (state, action) => {
      const { contactId, updatedContact } = action.payload;
      const contactIndex = state.items.findIndex(c => c.id === contactId);
      if (contactIndex !== -1) {
        // Merge existing metadata with updated membership
        state.items[contactIndex] = {
          ...state.items[contactIndex],
          ...updatedContact,
          metadata: {
            ...state.items[contactIndex].metadata,
            ...updatedContact.metadata,
            membership: updatedContact.membership // Ensure direct update
          }
        };
      }
    },
    // Add priority update reducer
    setPriority: (state, action) => {
      const { contactId, priority } = action.payload;
      state.priorityMap[contactId] = {
        priority,
        lastUpdated: Date.now()
      };
    },
    // Add cleanup reducer
    cleanupPriorities: (state) => {
      const currentContactIds = new Set(state.items.map(contact => contact.id));
      Object.keys(state.priorityMap).forEach(contactId => {
        if (!currentContactIds.has(parseInt(contactId))) {
          delete state.priorityMap[contactId];
        }
      });
    },
    addContact: (state, action) => {
      const newContact = action.payload;
      // Check if contact already exists
      const existingContactIndex = state.items.findIndex(contact => contact.id === newContact.id);
      
      if (existingContactIndex === -1) {
        // Add new contact with default membership if not specified
        state.items.push({
          ...newContact,
          metadata: {
            ...newContact.metadata,
            membership: newContact.metadata?.membership || 'join'
          }
        });
        logger.info('[ContactSlice] New contact added:', {
          contactId: newContact.id,
          displayName: newContact.display_name
        });
      } else {
        // Update existing contact
        state.items[existingContactIndex] = {
          ...state.items[existingContactIndex],
          ...newContact,
          metadata: {
            ...state.items[existingContactIndex].metadata,
            ...newContact.metadata,
            membership: newContact.metadata?.membership || state.items[existingContactIndex].metadata?.membership || 'join'
          }
        };
        logger.info('[ContactSlice] Contact updated:', {
          contactId: newContact.id,
          displayName: newContact.display_name
        });
      }
    },
    hideContact: (state, action) => {
      const contactId = action.payload;
      state.items = state.items.filter(contact => contact.id !== contactId);
    },
    updateContactDisplayName: (state, action) => {
      const { contactId, displayName } = action.payload;
      const contact = state.items.find(c => c.id === contactId);
      if (contact) {
        contact.display_name = displayName;
      }
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch contacts
      .addCase(fetchContacts.pending, (state) => {
        state.loading = true;
        state.error = null;
        logger.info('[Contacts] Starting contacts fetch');
      })
      .addCase(fetchContacts.fulfilled, (state, action) => {
        state.loading = false;
        
        // Directly use server-reported sync status
        const serverSyncState = action.payload.meta?.sync_info?.is_syncing;
        state.syncStatus.inProgress = serverSyncState || false;
        state.syncStatus.lastSyncTime = action.payload.meta?.sync_info?.last_sync;
        
        if (!serverSyncState) {
          state.items = action.payload.contacts.map(contact => ({
            ...contact,
            metadata: {
              ...contact.metadata,
              membership: contact.metadata?.membership || 'join'
            }
          }));
        }
        
        state.initialLoadComplete = true;
        logger.info('[Contacts] Sync state updated:', {
          inProgress: state.syncStatus.inProgress,
          lastSync: state.syncStatus.lastSyncTime
        });
      })
      .addCase(fetchContacts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || 'Failed to fetch contacts';
        state.initialLoadComplete = true;
        logger.info('[Contacts] Contacts fetch failed:', action.payload);
      })
      // Sync contacts
      .addCase(syncContact.pending, (state) => {
        state.syncStatus.inProgress = true;
        state.syncStatus.error = null;
      })
      .addCase(syncContact.fulfilled, (state, action) => {
        state.syncStatus.inProgress = false;
        state.syncStatus.lastSyncTime = Date.now();
        if (action.payload.contacts) {
          state.items = action.payload.contacts;
        }
      })
      .addCase(syncContact.rejected, (state, action) => {
        state.syncStatus.inProgress = false;
        state.syncStatus.error = action.payload || 'Failed to sync contacts';
      })
      // Handle priority update
      .addCase(updateContactPriority.fulfilled, (state, action) => {
        const { contactId, priority, timestamp } = action.payload;
        state.priorityMap[contactId] = {
          priority,
          lastUpdated: timestamp
        };
      })
      // Handle rehydration
      .addCase('persist/REHYDRATE', (state, action) => {
        if (action.payload?.contacts) {
          // Merge existing priorities with rehydrated ones
          state.priorityMap = {
            ...state.priorityMap,
            ...action.payload.contacts.priorityMap
          };
        }
      })
      .addCase(freshSyncContacts.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.isRefreshing = true;
      })
      .addCase(freshSyncContacts.fulfilled, (state, action) => {
        state.loading = false;
        state.isRefreshing = false;
        state.items = action.payload.data || [];
        state.lastSync = Date.now();
      })
      .addCase(freshSyncContacts.rejected, (state, action) => {
        state.loading = false;
        state.isRefreshing = false;
        state.error = action.payload;
      })
      // Add setSyncProgressState handler
      .addCase(setSyncProgressState, (state, action) => {
        state.syncStatus.inProgress = action.payload.inProgress;
        if (action.payload.lastSyncTime) {
          state.syncStatus.lastSyncTime = action.payload.lastSyncTime;
        }
      });
  }
});

// Export actions
export const { 
  clearContactError, 
  clearContacts,
  updateContactMembership,
  setPriority,
  cleanupPriorities,
  addContact,
  hideContact,
  updateContactDisplayName
} = contactSlice.actions;

// Export reducer
export const contactReducer = contactSlice.reducer;

// Selectors
export const selectAllContacts = (state) => state.contacts.items;
export const selectContactById = (state, contactId) =>
  state.contacts.items.find(contact => contact.id === contactId);
export const selectSyncStatus = (state) => state.contacts.syncStatus;
export const selectContactsLoading = (state) => state.contacts.loading;
export const selectContactsError = (state) => state.contacts.error;
export const selectLastSyncTime = (state) => state.contacts.syncStatus.lastSyncTime;
export const selectIsSyncing = (state) => state.contacts.syncStatus.inProgress;
export const selectInitialLoadComplete = (state) => state.contacts.initialLoadComplete;
export const selectContactPriority = (state, contactId) => 
  state.contacts.priorityMap[contactId]?.priority || PRIORITY_LEVELS.LOW; 