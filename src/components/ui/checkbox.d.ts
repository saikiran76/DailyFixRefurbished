import * as React from 'react';

export interface CheckboxProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  value?: string;
}

export const Checkbox: React.FC<CheckboxProps>; 