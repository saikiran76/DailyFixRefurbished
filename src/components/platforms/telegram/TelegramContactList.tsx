import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '@/store/store';
import { toast } from 'react-hot-toast';
import { Virtuoso } from 'react-virtuoso';
import { fetchContacts, selectContactPriority, freshSyncContacts, addContact } from '@/store/slices/contactSlice';
import logger from '@/utils/logger';
import { SYNC_STATES } from '@/utils/syncUtils';
import ContactItem from './ContactItem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, SlidersHorizontal, ArrowDownWideNarrow, ArrowUpWideNarrow, UserPlus, RefreshCw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
} from "@/components/ui/dropdown-menu";

const SORT_OPTIONS = {
  UNREAD: 'Unread',
  PRIORITY: 'Priority',
  ALPHABETICAL: 'Alphabetical',
};

const TelegramContactList = ({ onContactSelect, selectedContactId }) => {
  const dispatch = useDispatch<AppDispatch>();
  const contactState = useSelector((state: RootState) => state.contacts);
  const { user } = useSelector((state: RootState) => state.auth);
  const { 
    items: contacts = [], 
    loading, 
    syncStatus,
    error: syncError, 
    initialLoadComplete: hasInitialSynced 
  } = contactState || {};

  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('asc');
  const [activeSort, setActiveSort] = useState(SORT_OPTIONS.UNREAD);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContactId, setNewContactId] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const isSyncing = syncStatus?.inProgress;

  useEffect(() => {
    if (syncError) {
      toast.error(`Sync failed: ${syncError}`);
    }
  }, [syncError]);

  useEffect(() => {
    if (isSyncing) {
      setIsRefreshing(true);
    } else {
      setIsRefreshing(false);
    }
  }, [isSyncing]);

  useEffect(() => {
    if (!hasInitialSynced && user?.id) {
      logger.info("[TelegramContactList] Initial sync not detected. Fetching contacts.");
      dispatch(fetchContacts({ userId: user.id, platform: 'telegram' }));
    }
  }, [dispatch, hasInitialSynced, user?.id]);

  const handleRefreshClick = async () => {
    if (isRefreshing || !user?.id) return;
    logger.info('[TelegramContactList] Manual refresh triggered.');
    setIsRefreshing(true);
    try {
      await dispatch(freshSyncContacts({ userId: user.id, platform: 'telegram' })).unwrap();
      toast.success('Contacts refreshed successfully!');
    } catch (e: any) {
      logger.error('[TelegramContactList] Refresh failed', e);
      toast.error(e.message || 'Failed to refresh contacts.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddContact = async () => {
    if (!newContactId.trim()) {
      toast.error("Contact ID cannot be empty.");
      return;
    }
    if (!newContactId.startsWith('@')) {
      toast.error("Telegram user ID must start with @");
      return;
    }
    if (!user?.id) {
      toast.error("User not found");
      return;
    }
    try {
      await dispatch(addContact({ platform: 'telegram', contactId: newContactId, userId: user.id })).unwrap();
      toast.success(`Contact ${newContactId} added!`);
      setNewContactId('');
      setIsAddingContact(false);
    } catch (error: any) {
      toast.error(error.message || `Failed to add contact ${newContactId}.`);
    }
  };
  
  const handleContactSelect = useCallback((contact) => {
    onContactSelect(contact);
  }, [onContactSelect]);

  const sortedContacts = useMemo(() => {
    let filteredContacts = [...contacts]
      .filter(c => c.platform === 'telegram' && !c.hidden)
      .map(c => ({
          ...c,
          priority: selectContactPriority({ contacts: contactState } as RootState, c.id)
      }));

    switch (activeSort) {
      case SORT_OPTIONS.UNREAD:
        filteredContacts.sort((a, b) => (b.unread_count || 0) - (a.unread_count || 0));
        break;
      case SORT_OPTIONS.PRIORITY:
        filteredContacts.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        break;
      case SORT_OPTIONS.ALPHABETICAL:
        filteredContacts.sort((a, b) => a.name.localeCompare(b.name));
        break;
      default:
        break;
    }
    if (sortOrder === 'desc') {
      filteredContacts.reverse();
    }
    return filteredContacts;
  }, [contacts, activeSort, sortOrder, contactState]);

  const searchedContacts = useMemo(() => {
    if (!searchTerm) {
      return sortedContacts;
    }
    return sortedContacts.filter(contact =>
      contact.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [sortedContacts, searchTerm]);

  if (loading && !hasInitialSynced) {
    return (
      <div className="p-2 space-y-2">
        {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 relative">
      <div className="p-2 border-b dark:border-gray-700">
        <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-md px-2">
          <Search className="text-gray-500" size={20} />
          <Input
            type="text"
            placeholder="Search contacts..."
            className="w-full bg-transparent border-none focus:ring-0"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between pt-2">
          <div className="text-xs text-gray-500">{searchedContacts.length} contacts</div>
          <div className="flex items-center space-x-1">
            <Button variant="ghost" size="icon" onClick={() => setIsAddingContact(!isAddingContact)}>
              <UserPlus size={18} />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleRefreshClick} disabled={isRefreshing}>
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </Button>
            {/* 
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <SlidersHorizontal size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Sort By</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {Object.values(SORT_OPTIONS).map(opt => (
                      <DropdownMenuItem key={opt} onClick={() => setActiveSort(opt)}>
                        {opt} {activeSort === opt && '✓'}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}>
                  <span>Order: {sortOrder === 'asc' ? <ArrowUpWideNarrow className="ml-2 h-4 w-4 inline" /> : <ArrowDownWideNarrow className="ml-2 h-4 w-4 inline" />}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            */}
          </div>
        </div>
        {isAddingContact && (
          <div className="flex items-center pt-2 space-x-2">
            <Input
              type="text"
              placeholder="@username"
              value={newContactId}
              onChange={(e) => setNewContactId(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddContact()}
              className="h-9"
            />
            <Button onClick={handleAddContact}>Add</Button>
          </div>
        )}
      </div>

      <div className="flex-grow overflow-y-auto">
        {isSyncing && (
          <div className="p-4 text-center text-sm text-gray-500">
            <p>Syncing new contacts...</p>
            <p className="text-xs">This may take a moment.</p>
          </div>
        )}
        {searchedContacts.length === 0 && !loading ? (
          <div className="text-center p-4 text-gray-500">
            {searchTerm ? (
              <p>No contacts found for "{searchTerm}"</p>
            ) : (
              <p>No Telegram contacts yet.</p>
            )}
          </div>
        ) : (
          <Virtuoso
            style={{ height: '100%' }}
            data={searchedContacts}
            className="p-2"
            itemContent={(index, contact) => (
              <div style={{ paddingBottom: '4px' }}>
                <ContactItem
                  contact={contact}
                  isSelected={contact.id === selectedContactId}
                  onClick={() => handleContactSelect(contact)}
                />
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
};

export default TelegramContactList;
