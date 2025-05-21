import * as React from 'react';

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
}

export const Separator: React.FC<SeparatorProps>; 