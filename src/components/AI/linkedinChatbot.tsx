import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BotMessageSquare, Send, X } from 'lucide-react';

interface LinkedInChatbotProps {
  contactId: string;
}

const LinkedInChatbot: React.FC<LinkedInChatbotProps> = ({ contactId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async () => {
    if (!message.trim()) return;
    
    setIsLoading(true);
    // TODO: Implement LinkedIn-specific AI chatbot logic
    console.log('LinkedIn Chatbot message:', message, 'for contact:', contactId);
    
    // Simulate AI response
    setTimeout(() => {
      setIsLoading(false);
      setMessage('');
    }, 1000);
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        size="sm"
        className="bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200"
      >
        <BotMessageSquare className="h-4 w-4 mr-2" />
        AI Assistant
      </Button>
    );
  }

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-blue-600">
            LinkedIn AI Assistant
          </CardTitle>
          <Button
            onClick={() => setIsOpen(false)}
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-blue-400"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex space-x-2">
          <Input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask AI about this LinkedIn conversation..."
            className="text-sm"
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          />
          <Button
            onClick={handleSendMessage}
            disabled={isLoading || !message.trim()}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-blue-500 mt-2">
          Get insights and suggestions for your LinkedIn conversation
        </p>
      </CardContent>
    </Card>
  );
};

export default LinkedInChatbot; 