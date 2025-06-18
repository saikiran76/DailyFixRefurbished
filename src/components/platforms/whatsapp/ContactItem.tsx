import React, { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { priorityService, type Priority } from '@/services/priorityService';
import PriorityBadge from '@/components/ui/PriorityBadge';

const ContactItem = ({ contact, isSelected, onClick, unreadCount }) => {
  const [priority, setPriority] = useState<Priority>('medium');

  // Load priority when component mounts or contact changes
  useEffect(() => {
    if (contact?.id) {
      const contactPriority = priorityService.getPriority(contact.id);
      setPriority(contactPriority);
    }
  }, [contact?.id]);

  // Listen for priority changes
  useEffect(() => {
    const handlePriorityChange = (event: CustomEvent) => {
      const { contactId, priority: newPriority } = event.detail;
      if (contactId === contact?.id) {
        setPriority(newPriority as Priority);
      }
    };

    window.addEventListener('priority-changed', handlePriorityChange as EventListener);
    return () => {
      window.removeEventListener('priority-changed', handlePriorityChange as EventListener);
    };
  }, [contact?.id]);

  return (
    <div
      className={`flex items-center p-3 hover:bg-accent cursor-pointer transition-colors ${
        isSelected ? 'bg-accent' : ''
      }`}
      onClick={onClick}
    >
      <Avatar className="h-12 w-12">
        <AvatarImage src={contact.avatar_url} />
        <AvatarFallback>{contact.name?.charAt(0) || '?'}</AvatarFallback>
      </Avatar>
      <div className="ml-3 flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="font-semibold truncate">{contact.name}</div>
          <PriorityBadge 
            priority={priority} 
            size="sm" 
            showLabel={false}
            className="ml-2"
          />
        </div>
        <div className="text-sm text-muted-foreground truncate">
          {contact.last_message || 'No messages'}
        </div>
      </div>
      {unreadCount > 0 && (
        <div className="ml-2 bg-primary text-primary-foreground text-xs rounded-full px-2 py-1 min-w-[20px] text-center">
          {unreadCount}
        </div>
      )}
    </div>
  );
};

export default ContactItem;
