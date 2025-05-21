import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import LavaLamp from '@/components/ui/Loader/LavaLamp';

interface ConfirmActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string | ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  isLoading?: boolean;
}

const ConfirmActionModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  isLoading = false,
}: ConfirmActionModalProps) => {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="sm:max-w-[425px]">
        <AlertDialogHeader className="gap-2">
          <AlertDialogTitle className="text-xl">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-2 mt-4">
          <AlertDialogCancel asChild className="mt-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isLoading}
              className="w-full sm:w-auto"
            >
              {cancelText}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild className="mt-0">
            <Button
              variant={variant}
              size="sm"
              onClick={onConfirm}
              disabled={isLoading}
              className={variant === "destructive" ? "bg-destructive hover:bg-destructive/90 w-full sm:w-auto" : "w-full sm:w-auto"}
            >
              {isLoading ? (
                <>
                  <LavaLamp className="w-[20px] h-[40px] mr-3" />
                  Processing...
                </>
              ) : (
                confirmText
              )}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ConfirmActionModal; 