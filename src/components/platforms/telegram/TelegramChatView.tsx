
import React, { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '@/store/store';
import { toast } from 'react-hot-toast';
import { Virtuoso } from 'react-virtuoso';
import {
  fetchMessages,
  sendMessage,
  markMessagesAsRead,
  fetchNewMessages,
  refreshMessages,
  selectMessages,
  selectMessageLoading,
  selectHasMoreMessages,
  selectLastKnownMessageId,
  selectCurrentPage,
} from '@/store/slices/messageSlice';
import MessageItem from './MessageItem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Paperclip, Send, RefreshCw, Mic, Video } from 'lucide-react';
import logger from '@/utils/logger';
import { Skeleton } from '@/components/ui/skeleton';

const TelegramChatView = ({ selectedContact, currentUser }) => {
  const dispatch = useDispatch<AppDispatch>();
  const [newMessage, setNewMessage] = useState('');
  const messages = useSelector((state: RootState) => selectMessages(state, selectedContact?.id));
  const loading = useSelector(selectMessageLoading);
  const hasMoreMessages = useSelector(selectHasMoreMessages);
  const lastEventId = useSelector((state: RootState) => selectLastKnownMessageId(state, selectedContact?.id));
  const currentPage = useSelector((state: RootState) => selectCurrentPage(state));
  const virtuosoRef = useRef(null);

  useEffect(() => {
    if (selectedContact?.id) {
      dispatch(fetchMessages({ contactId: selectedContact.id, page: 0, limit: 20, platform: 'telegram' }));
    }
  }, [selectedContact, dispatch]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
          virtuosoRef.current?.scrollToIndex({
          index: messages.length - 1,
          align: 'end',
          behavior: 'smooth',
        });
      }, 100);
    }
  }, [messages, selectedContact]);

  useEffect(() => {
    const fetchNew = async () => {
      if (selectedContact?.id && lastEventId) {
        try {
          await dispatch(fetchNewMessages({ contactId: selectedContact.id, lastEventId, platform: 'telegram' })).unwrap();
        } catch (error) {
          logger.error('Failed to fetch new messages:', error);
        }
      }
    };
    const interval = setInterval(fetchNew, 5000);
    return () => clearInterval(interval);
  }, [selectedContact, lastEventId, dispatch]);

  const handleSendMessage = () => {
    if (newMessage.trim() && selectedContact?.id) {
      dispatch(sendMessage({ contactId: selectedContact.id, message: { content: newMessage }, platform: 'telegram' }));
      setNewMessage('');
    }
  };

  const handleRefresh = async () => {
    if (selectedContact?.id) {
      toast.promise(
        dispatch(refreshMessages({ contactId: selectedContact.id, platform: 'telegram' })).unwrap(),
        {
          loading: 'Refreshing messages...',
          success: 'Messages refreshed!',
          error: 'Failed to refresh messages.',
        }
      );
    }
  };

  const loadMoreMessages = () => {
    if (hasMoreMessages && !loading && selectedContact) {
      dispatch(fetchMessages({ contactId: selectedContact.id, page: currentPage + 1, limit: 20, platform: 'telegram' }));
    }
  };

  if (!selectedContact) {
    return <div className="flex items-center justify-center h-full text-gray-500">Select a contact to start messaging</div>;
  }
  
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      <header className="flex items-center justify-between p-4 border-b dark:border-gray-700">
        <div className="font-bold text-lg">{selectedContact.name}</div>
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="icon"><Video /></Button>
          <Button variant="ghost" size="icon"><Mic /></Button>
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </header>
      
      <div className="flex-grow p-4 overflow-y-auto">
        {loading && messages.length === 0 ? (
          <div className="space-y-4">
            {[...Array(10)].map((_, i) => <Skeleton key={i} className={`h-12 w-3/4 ${i % 2 === 0 ? 'ml-auto' : ''}`} />)}
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%' }}
            data={messages}
            firstItemIndex={hasMoreMessages ? 1 : 0}
            startReached={loadMoreMessages}
            initialTopMostItemIndex={messages.length - 1}
            followOutput={'auto'}
            components={{
              Header: () => hasMoreMessages && !loading ? <div className="flex justify-center p-4"><Button onClick={loadMoreMessages}>Load More</Button></div> : null,
            }}
            itemContent={(index, message) => (
              <div className="pb-2">
                <MessageItem
                  key={message.id || message.message_id}
                  message={message}
                  currentUser={currentUser}
                />
              </div>
            )}
          />
        )}
        {/*
          <telegramChatbot contactId={selectedContact?.id}>
          </telegramChatbot>
        */}
      </div>
      
      <footer className="p-4 border-t dark:border-gray-700">
        <div className="flex items-center bg-white dark:bg-gray-800 rounded-full px-4 py-2">
          <Button variant="ghost" size="icon"><Paperclip /></Button>
          <Input
            type="text"
            placeholder="Type a message"
            className="flex-grow bg-transparent border-none focus:ring-0"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          />
          <Button variant="ghost" size="icon" onClick={handleSendMessage}><Send /></Button>
        </div>
      </footer>
    </div>
  );
};

export const ChatViewWithErrorBoundary = TelegramChatView;
export default TelegramChatView;
