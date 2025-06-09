import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useLogger } from "@/hooks/useLogger";
import { cn } from "@/lib/utils";

interface SessionExpiredModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SessionExpiredModal = ({ isOpen, onClose }: SessionExpiredModalProps) => {
  const navigate = useNavigate();
  const logger = useLogger();

  // When opened, log the session expiration and auto-redirect after a delay
  useEffect(() => {
    if (isOpen) {
      logger.warn('Session expired modal opened');
      
      // Auto-redirect to login page after 3 seconds
      const redirectTimer = setTimeout(() => {
        handleLogin();
      }, 3000);
      
      return () => clearTimeout(redirectTimer);
    }
  }, [isOpen, logger]);

  const handleLogin = () => {
    onClose();
    navigate('/login');
  };

  return (
    <AlertDialog className="bg-neutral-800" open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="sm:max-w-[425px] bg-neutral-800 border-gray-700">
        <AlertDialogHeader className="gap-2">
          <AlertDialogTitle variant="destructive" className="text-xl">Session Expired</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            Your session has expired. Please log in again to continue using the application.
            Redirecting to login page...
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogAction asChild className="w-full sm:w-auto">
            <p className="">Please Refresh the page to login</p>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default SessionExpiredModal; 