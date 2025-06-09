import React from 'react';
import { motion } from 'framer-motion';
import LavaLamp from '@/components/ui/Loader/LavaLamp';

interface CentralLoaderProps {
  message?: string;
  subMessage?: string;
  showButton?: boolean;
  buttonText?: string;
  onButtonClick?: () => void;
}

/**
 * A consistent, centered loader component for use throughout the application
 */
const CentralLoader: React.FC<CentralLoaderProps> = ({
  message = 'Loading...',
  subMessage,
  showButton = false,
  buttonText = 'Continue',
  onButtonClick
}) => {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm z-50">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center p-8 rounded-lg bg-background max-w-md text-center"
      >
        <LavaLamp className="w-[60px] h-[100px] mb-4" />
        
        <h3 className="text-xl font-medium text-foreground mb-2">
          {message}
        </h3>
        
        {subMessage && (
          <p className="text-sm text-muted-foreground mb-4">
            {subMessage}
          </p>
        )}
        
        {showButton && (
          <button 
            onClick={onButtonClick}
            className="mt-4 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            {buttonText}
          </button>
        )}
      </motion.div>
    </div>
  );
};

export default CentralLoader; 