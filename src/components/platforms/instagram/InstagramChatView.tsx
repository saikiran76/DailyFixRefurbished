import React, { useState, useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Send, 
  RefreshCw, 
  BotMessageSquare, 
  Images,
  MoreVertical,
  Heart,
  MessageCircle,
  Share,
  Bookmark
} from "lucide-react";
import { toast } from 'react-hot-toast';
import { priorityService } from '@/services/priorityService';
import PriorityBadge from '@/components/ui/PriorityBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Message {
  id: string;
  content: string;
  timestamp: Date;
  sender: 'user' | 'contact';
  type: 'text' | 'image' | 'video';
  reactions?: string[];
  likes?: number;
}

interface Contact {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  isVerified?: boolean;
  followers?: number;
  following?: number;
}

interface InstagramChatViewProps {
  contact: Contact;
  onBackgroundChange?: () => void;
}

const InstagramChatView: React.FC<InstagramChatViewProps> = ({ 
  contact, 
  onBackgroundChange 
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { session } = useSelector((state: any) => state.auth);

  // Sample Instagram-style messages
  const sampleMessages: Message[] = [
    {
      id: '1',
      content: 'Hey! Love your latest post! 📸',
      timestamp: new Date(Date.now() - 1000 * 60 * 30),
      sender: 'contact',
      type: 'text',
      likes: 3
    },
    {
      id: '2',
      content: 'Thanks! That sunset was incredible 🌅',
      timestamp: new Date(Date.now() - 1000 * 60 * 25),
      sender: 'user',
      type: 'text',
      likes: 1
    },
    {
      id: '3',
      content: 'Are you going to the photography meetup this weekend?',
      timestamp: new Date(Date.now() - 1000 * 60 * 20),
      sender: 'contact',
      type: 'text'
    },
    {
      id: '4',
      content: 'Definitely! Can\'t wait to see everyone\'s work 📷',
      timestamp: new Date(Date.now() - 1000 * 60 * 15),
      sender: 'user',
      type: 'text'
    },
    {
      id: '5',
      content: 'Just shared a new story, check it out! ✨',
      timestamp: new Date(Date.now() - 1000 * 60 * 5),
      sender: 'contact',
      type: 'text',
      likes: 2
    }
  ];

  // Load priority from service
  useEffect(() => {
    const contactPriority = priorityService.getPriority(contact.id);
    setPriority(contactPriority);
  }, [contact.id]);

  // Load messages
  useEffect(() => {
    setMessages(sampleMessages);
  }, [contact.id]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle priority change
  const handlePriorityChange = () => {
    const newPriority = priorityService.cyclePriority(contact.id);
    setPriority(newPriority);
    toast.success(`Priority set to ${newPriority}`);
  };

  // Handle send message
  const handleSendMessage = () => {
    if (!newMessage.trim()) return;

    const message: Message = {
      id: Date.now().toString(),
      content: newMessage,
      timestamp: new Date(),
      sender: 'user',
      type: 'text'
    };

    setMessages(prev => [...prev, message]);
    setNewMessage('');
    
    // Simulate response
    setTimeout(() => {
      const responses = [
        "That's awesome! 🔥",
        "Love it! ❤️",
        "Can't wait to see more!",
        "Amazing content as always! 👏",
        "This is so inspiring! ✨"
      ];
      
      const response: Message = {
        id: (Date.now() + 1).toString(),
        content: responses[Math.floor(Math.random() * responses.length)],
        timestamp: new Date(),
        sender: 'contact',
        type: 'text'
      };
      
      setMessages(prev => [...prev, response]);
    }, 1000 + Math.random() * 2000);
  };

  // Handle refresh messages
  const handleRefreshMessages = async () => {
    setIsLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success('Messages refreshed');
    } catch (error) {
      toast.error('Failed to refresh messages');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle AI summary
  const handleAISummary = () => {
    const summaryMessages = [
      "📸 Recent conversation highlights: Photography meetup planning, positive feedback on sunset post, and story sharing updates.",
      "🎨 Chat summary: Creative collaboration discussion, weekend event coordination, and mutual appreciation for content.",
      "✨ Key points: Photography community engagement, upcoming meetup attendance, and positive social interactions."
    ];
    
    const summary = summaryMessages[Math.floor(Math.random() * summaryMessages.length)];
    toast.success(summary, { duration: 5000 });
  };

  // Format timestamp
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 border-b bg-card">
        <div className="flex items-center space-x-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={contact.avatar} alt={contact.name} />
            <AvatarFallback className="bg-pink-100 text-pink-600">
              {contact.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <h3 className="font-semibold text-foreground">{contact.name}</h3>
              {contact.isVerified && (
                <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-600">
                  ✓
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">@{contact.username}</p>
            {contact.followers && (
              <p className="text-xs text-muted-foreground">
                {contact.followers.toLocaleString()} followers
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <PriorityBadge 
            priority={priority} 
            size="sm" 
            onClick={handlePriorityChange}
            className="cursor-pointer hover:opacity-80"
          />
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefreshMessages}
            disabled={isLoading}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleAISummary}
            className="text-muted-foreground hover:text-foreground"
            title="AI Chat Summary"
          >
            <BotMessageSquare className="h-4 w-4" />
          </Button>

          {onBackgroundChange && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBackgroundChange}
              className="text-muted-foreground hover:text-foreground"
              title="Change Background"
            >
              <Images className="h-4 w-4" />
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toast.info('View Profile')}>
                View Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info('Mute Conversation')}>
                Mute Conversation
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info('Block User')}>
                Block User
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      {/* Messages */}
      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-full p-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className="flex items-end space-x-2 max-w-xs lg:max-w-md">
                  {message.sender === 'contact' && (
                    <Avatar className="h-6 w-6 mb-1">
                      <AvatarImage src={contact.avatar} alt={contact.name} />
                      <AvatarFallback className="bg-pink-100 text-pink-600 text-xs">
                        {contact.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  
                  <div
                    className={`rounded-2xl px-3 py-2 ${
                      message.sender === 'user'
                        ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white'
                        : 'bg-muted text-foreground border'
                    }`}
                  >
                    <p className="text-sm">{message.content}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className={`text-xs ${
                        message.sender === 'user' ? 'text-pink-100' : 'text-muted-foreground'
                      }`}>
                        {formatTime(message.timestamp)}
                      </p>
                      
                      {message.likes && message.likes > 0 && (
                        <div className="flex items-center space-x-1 ml-2">
                          <Heart className="h-3 w-3 text-red-500 fill-current" />
                          <span className={`text-xs ${
                            message.sender === 'user' ? 'text-pink-100' : 'text-muted-foreground'
                          }`}>
                            {message.likes}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {message.sender === 'user' && (
                    <Avatar className="h-6 w-6 mb-1">
                      <AvatarFallback className="bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs">
                        {session?.user?.name?.charAt(0).toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      </CardContent>

      {/* Message Input */}
      <div className="p-4 border-t bg-card">
        <div className="flex items-center space-x-2">
          <div className="flex-1 relative">
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Message..."
              className="pr-12 rounded-full border-muted-foreground/20 focus:border-pink-500"
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center space-x-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-pink-500"
                title="Add emoji"
              >
                😊
              </Button>
            </div>
          </div>
          
          <Button
            onClick={handleSendMessage}
            disabled={!newMessage.trim()}
            className="rounded-full bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white"
            size="sm"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Instagram-style action buttons */}
        <div className="flex items-center justify-center space-x-6 mt-3 pt-2 border-t border-muted-foreground/10">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-red-500">
            <Heart className="h-4 w-4 mr-1" />
            Like
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-blue-500">
            <MessageCircle className="h-4 w-4 mr-1" />
            Comment
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-green-500">
            <Share className="h-4 w-4 mr-1" />
            Share
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-yellow-500">
            <Bookmark className="h-4 w-4 mr-1" />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};

export default InstagramChatView; 