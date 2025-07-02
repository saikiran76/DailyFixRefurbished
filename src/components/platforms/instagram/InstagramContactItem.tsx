import React, { useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { priorityService } from '@/services/priorityService';
import PriorityBadge from '@/components/ui/PriorityBadge';

interface Contact {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  isVerified?: boolean;
  followers?: number;
  lastMessage?: string;
  lastMessageTime?: Date;
  unreadCount?: number;
  isOnline?: boolean;
  hasStory?: boolean;
}

interface InstagramContactItemProps {
  contact: Contact;
  isSelected?: boolean;
  onClick?: () => void;
}

const InstagramContactItem: React.FC<InstagramContactItemProps> = ({
  contact,
  isSelected = false,
  onClick
}) => {
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');

  // Load priority from service
  useEffect(() => {
    const contactPriority = priorityService.getPriority(contact.id);
    setPriority(contactPriority);
  }, [contact.id]);

  // Listen for priority changes
  useEffect(() => {
    const handlePriorityChange = (event: CustomEvent) => {
      if (event.detail.contactId === contact.id) {
        setPriority(event.detail.priority);
      }
    };

    window.addEventListener('priority-changed', handlePriorityChange as EventListener);
    return () => {
      window.removeEventListener('priority-changed', handlePriorityChange as EventListener);
    };
  }, [contact.id]);

  // Format last message time
  const formatLastMessageTime = (date?: Date) => {
    if (!date) return '';
    
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  };

  return (
    <div
      onClick={onClick}
      className={`flex items-center p-3 hover:bg-muted/50 cursor-pointer transition-colors ${
        isSelected ? 'bg-muted border-l-4 border-l-pink-500' : ''
      }`}
    >
      <div className="relative">
        <Avatar className="h-12 w-12">
          <AvatarImage src={contact.avatar} alt={contact.name} />
          <AvatarFallback className="bg-pink-100 text-pink-600">
            {contact.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        
        {/* Story ring */}
        {contact.hasStory && (
          <div className="absolute inset-0 rounded-full border-2 border-gradient-to-r from-pink-500 to-purple-600 p-0.5">
            <div className="w-full h-full rounded-full bg-background"></div>
          </div>
        )}
        
        {/* Online indicator */}
        {contact.isOnline && (
          <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-background rounded-full"></div>
        )}
      </div>

      <div className="flex-1 ml-3 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 min-w-0">
            <h3 className="font-medium text-foreground truncate">
              {contact.name}
            </h3>
            {contact.isVerified && (
              <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-600 px-1 py-0">
                ✓
              </Badge>
            )}
          </div>
          
          <div className="flex items-center space-x-2 flex-shrink-0">
            <PriorityBadge priority={priority} size="sm" />
            {contact.lastMessageTime && (
              <span className="text-xs text-muted-foreground">
                {formatLastMessageTime(contact.lastMessageTime)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-1">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground truncate">
              @{contact.username}
            </p>
            {contact.lastMessage && (
              <p className="text-sm text-muted-foreground truncate mt-0.5">
                {contact.lastMessage}
              </p>
            )}
            {contact.followers && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {contact.followers.toLocaleString()} followers
              </p>
            )}
          </div>
          
          {contact.unreadCount && contact.unreadCount > 0 && (
            <Badge 
              variant="default" 
              className="bg-pink-500 text-white text-xs min-w-[20px] h-5 flex items-center justify-center rounded-full"
            >
              {contact.unreadCount > 99 ? '99+' : contact.unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
};

export default InstagramContactItem; 