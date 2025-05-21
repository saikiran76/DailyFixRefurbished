import * as React from 'react';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'destructive';
  className?: string;
}

export interface AlertDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {
  className?: string;
}

export const Alert: React.FC<AlertProps>;
export const AlertDescription: React.FC<AlertDescriptionProps>; 