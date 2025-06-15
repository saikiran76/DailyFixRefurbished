
import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const ContactItem = ({ contact, isSelected, onClick, unreadCount }) => {
  return (
    <div
      onClick={onClick}
      className={`flex items-center p-2 rounded-md cursor-pointer ${isSelected ? 'bg-green-100 dark:bg-green-900/50' : 'hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}
    >
      <Avatar className="h-10 w-10 mr-3">
        <AvatarImage src={contact.avatar_url} alt={contact.name} />
        <AvatarFallback>{contact.name?.[0]?.toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex-grow overflow-hidden">
        <div className="font-semibold truncate">{contact.name}</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
          {contact.last_message_preview || 'No messages yet'}
        </p>
      </div>
      {unreadCount > 0 && (
        <div className="ml-2 flex-shrink-0">
          <span className="text-xs font-bold bg-green-500 text-white rounded-full h-5 w-5 flex items-center justify-center">
            {unreadCount}
          </span>
        </div>
      )}
    </div>
  );
};

export default ContactItem;
