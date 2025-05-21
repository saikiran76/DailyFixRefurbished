import * as React from 'react';

export interface AlertDialogProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export interface AlertDialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  asChild?: boolean;
}

export interface AlertDialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export interface AlertDialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export interface AlertDialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export interface AlertDialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  className?: string;
}

export interface AlertDialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  className?: string;
}

export interface AlertDialogCancelProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
}

export interface AlertDialogActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
}

export const AlertDialog: React.FC<AlertDialogProps>;
export const AlertDialogTrigger: React.FC<AlertDialogTriggerProps>;
export const AlertDialogContent: React.FC<AlertDialogContentProps>;
export const AlertDialogHeader: React.FC<AlertDialogHeaderProps>;
export const AlertDialogFooter: React.FC<AlertDialogFooterProps>;
export const AlertDialogTitle: React.FC<AlertDialogTitleProps>;
export const AlertDialogDescription: React.FC<AlertDialogDescriptionProps>;
export const AlertDialogCancel: React.FC<AlertDialogCancelProps>;
export const AlertDialogAction: React.FC<AlertDialogActionProps>; 