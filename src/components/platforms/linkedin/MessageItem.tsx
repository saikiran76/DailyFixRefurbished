import React from 'react';
import { format } from 'date-fns';

// TypeScript interface for LinkedIn message component props
interface MessageItemProps {
  message: {
    id?: string | number;
    message_id?: string | number;
    sender_id?: string | number;
    is_outgoing?: boolean;
    content?: string;
    timestamp?: string | number | Date;
    media_url?: string;
    status?: 'sent' | 'delivered' | 'read' | string;
    sender?: string;
    contact_display_name?: string;
  };
  currentUser: {
    id?: string | number;
  } | null;
  className?: string;
}

const MessageItem: React.FC<MessageItemProps> = ({ message, currentUser, className = '' }) => {
  const isOutgoing = message.sender_id === currentUser?.id || message.is_outgoing;
  
  // CRITICAL FIX: Safely format the timestamp with validation
  const formattedTime = (() => {
    try {
      if (!message.timestamp) return '';
      const date = new Date(message.timestamp);
      if (isNaN(date.getTime())) return '';
      return format(date, 'HH:mm');
    } catch (error) {
      console.warn('[LinkedIn MessageItem] Invalid timestamp format:', message.timestamp, error);
      return '';
    }
  })();
  
  // Generate message status icon based on status (LinkedIn style)
  const getStatusIcon = () => {
    switch (message.status) {
      case 'sent':
        return <span className="text-gray-400">✓</span>;
      case 'delivered':
        return <span className="text-gray-400">✓✓</span>;
      case 'read':
        return <span className="text-blue-500">✓✓</span>;
      default:
        return null;
    }
  };

  // Handle LinkedIn message content with proper formatting
  const getMessageContent = (content: string | undefined) => {
    if (!content) return null;
    
    // Check if it's a URL (LinkedIn often has profile/post links)
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    if (urlRegex.test(content)) {
      return (
        <div>
          {content.split(urlRegex).map((part, i) => 
            urlRegex.test(part) ? (
              <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                {part}
              </a>
            ) : part
          )}
        </div>
      );
    }
    
    return content;
  };

  return (
    <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} ${className}`}>
      <div 
        className={`rounded-lg px-3 py-2 max-w-full ${
          isOutgoing 
            ? 'bg-blue-600 text-white mr-2 rounded-tr-none' 
            : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 ml-2 rounded-tl-none border border-gray-200 dark:border-gray-700'
        }`}
        style={{
          maxWidth: '100%',
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          whiteSpace: 'pre-wrap',
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
      >
        {/* Show sender name for incoming LinkedIn messages */}
        {!isOutgoing && (message.sender || message.contact_display_name) && (
          <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
            {message.sender || message.contact_display_name}
          </div>
        )}
        
        {message.content && (
          <div className="text-sm whitespace-pre-wrap break-words overflow-hidden">
            {getMessageContent(message.content)}
          </div>
        )}
        
        {message.media_url && (
          <div className="mb-1 rounded overflow-hidden">
            <img 
              src={message.media_url} 
              alt="Media" 
              className="max-w-full rounded"
              style={{ maxHeight: '200px', objectFit: 'contain' }}
            />
          </div>
        )}
        
        <div className={`flex justify-end items-center mt-1 space-x-1 text-xs ${
          isOutgoing 
            ? 'text-blue-100' 
            : 'text-gray-500 dark:text-gray-400'
        }`}>
          <span>{formattedTime}</span>
          {isOutgoing && getStatusIcon()}
        </div>
      </div>
    </div>
  );
};

export default MessageItem; 