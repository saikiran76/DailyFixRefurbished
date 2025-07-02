import React from 'react';
import { format } from 'date-fns';

// Add TypeScript interface for the component props
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
      console.warn('[MessageItem] Invalid timestamp format:', message.timestamp, error);
      return '';
    }
  })();
  
  // Generate message status icon based on status
  const getStatusIcon = () => {
    switch (message.status) {
      case 'sent':
        return <span className="text-gray-400">✓</span>;
      case 'delivered':
        return <span className="text-gray-400">✓✓</span>;
      case 'read':
        return <span className="text-blue-400">✓✓</span>;
      default:
        return null;
    }
  };

  // Ensure we have a valid message ID
  const getMessageContent = (content: string | undefined) => {
    if (!content) return null;
    
    // Check if it's a URL
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    if (urlRegex.test(content)) {
      return (
        <div>
          {content.split(urlRegex).map((part, i) => 
            urlRegex.test(part) ? (
              <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">
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
            ? 'bg-chat-bubble-sent text-chat-bubble-sent-foreground mr-2 rounded-tr-none' 
            : 'bg-chat-bubble text-chat-bubble-foreground ml-2 rounded-tl-none'
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
        
        <div className="flex justify-end items-center mt-1 space-x-1 text-xs text-muted-foreground">
          <span>{formattedTime}</span>
          {isOutgoing && getStatusIcon()}
        </div>
      </div>
    </div>
  );
};

export default MessageItem;