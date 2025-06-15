
import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const ContactItem = ({ contact, isSelected, onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`flex items-center p-2 rounded-md cursor-pointer ${isSelected ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}
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
      {contact.unread_count > 0 && (
        <div className="flex flex-col items-end ml-2">
            <span className="text-xs text-gray-400 whitespace-nowrap">{contact.last_message_time}</span>
            <span className="mt-1 text-xs font-bold bg-blue-500 text-white rounded-full h-5 w-5 flex items-center justify-center">
            {contact.unread_count}
            </span>
        </div>
      )}
    </div>
  );
};

export default ContactItem;
