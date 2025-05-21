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

  // When opened, log the session expiration
  useEffect(() => {
    if (isOpen) {
      logger.warn('Session expired modal opened');
    }
  }, [isOpen, logger]);

  const handleLogin = () => {
    onClose();
    navigate('/login');
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="sm:max-w-[425px]">
        <AlertDialogHeader className="gap-2">
          <AlertDialogTitle className="text-xl">Session Expired</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            Your session has expired. Please log in again to continue using the application.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-4">
          <AlertDialogAction asChild className="w-full sm:w-auto">
            <Button 
              onClick={handleLogin}
              variant="default"
              size="default"
              className="w-full sm:w-auto"
            >
              Log In
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default SessionExpiredModal; 