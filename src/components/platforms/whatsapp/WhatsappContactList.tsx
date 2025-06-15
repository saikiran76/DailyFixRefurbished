
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Virtuoso } from 'react-virtuoso';
import type { RootState, AppDispatch } from '@/store/store';
import { fetchContacts, selectAllContacts } from '@/store/slices/contactSlice';
import ContactItem from './ContactItem';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import useWhatsAppNotifications from '@/hooks/useWhatsAppNotifications';

const WhatsappContactList = ({ onContactSelect, selectedContactId }) => {
  const dispatch = useDispatch<AppDispatch>();
  const { items: contacts, loading, initialLoadComplete: hasInitialSynced } = useSelector((state: RootState) => state.contacts);
  const { user } = useSelector((state: RootState) => state.auth);
  const [searchTerm, setSearchTerm] = useState('');
  
  const { unreadNotifications, markAsRead } = useWhatsAppNotifications();

  useEffect(() => {
    if (!hasInitialSynced && user?.id) {
      dispatch(fetchContacts({ userId: user.id, platform: 'whatsapp' }));
    }
  }, [dispatch, hasInitialSynced, user?.id]);

  const notificationsByContact = useMemo(() => {
    const grouped = {};
    unreadNotifications.forEach(notification => {
      const contactId = notification.roomId;
      if (!grouped[contactId]) {
        grouped[contactId] = 0;
      }
      grouped[contactId]++;
    });
    return grouped;
  }, [unreadNotifications]);
  
  const handleContactSelect = useCallback((contact) => {
    onContactSelect(contact);
    const contactNotifications = unreadNotifications.filter(n => n.roomId === contact.id);
    contactNotifications.forEach(notification => {
      markAsRead(notification.id);
    });
  }, [onContactSelect, unreadNotifications, markAsRead]);

  const whatsappContacts = useMemo(() => {
    return contacts.filter(c => c.platform === 'whatsapp' && !c.hidden);
  }, [contacts]);

  const searchedContacts = useMemo(() => {
    if (!searchTerm) {
      return whatsappContacts;
    }
    return whatsappContacts.filter(contact =>
      contact.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [whatsappContacts, searchTerm]);

  if (loading && !hasInitialSynced) {
    return (
      <div className="p-2 space-y-2">
        {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
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
      </div>
      <div className="flex-grow overflow-y-auto">
        {searchedContacts.length === 0 ? (
          <div className="text-center p-4 text-gray-500">
            No WhatsApp contacts found.
          </div>
        ) : (
          <Virtuoso
            style={{ height: '100%' }}
            data={searchedContacts}
            itemContent={(index, contact) => (
              <div className="p-1">
                <ContactItem
                  contact={contact}
                  isSelected={contact.id === selectedContactId}
                  onClick={() => handleContactSelect(contact)}
                  unreadCount={notificationsByContact[contact.id] || 0}
                />
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
};

export default WhatsappContactList;
