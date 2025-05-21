import * as React from 'react';

export interface SheetProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

export interface SheetTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  asChild?: boolean;
}

export interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export interface SheetHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export interface SheetFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export interface SheetTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  className?: string;
}

export interface SheetDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  className?: string;
}

export interface SheetCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  asChild?: boolean;
}

export const Sheet: React.FC<SheetProps>;
export const SheetTrigger: React.FC<SheetTriggerProps>;
export const SheetContent: React.FC<SheetContentProps>;
export const SheetHeader: React.FC<SheetHeaderProps>;
export const SheetFooter: React.FC<SheetFooterProps>;
export const SheetTitle: React.FC<SheetTitleProps>;
export const SheetDescription: React.FC<SheetDescriptionProps>;
export const SheetClose: React.FC<SheetCloseProps>; 