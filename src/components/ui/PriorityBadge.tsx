import React from 'react';
import { cn } from '@/lib/utils';

export type Priority = 'low' | 'medium' | 'high';

interface PriorityBadgeProps {
  priority: Priority;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  onClick?: () => void;
  className?: string;
}

const priorityConfig = {
  high: {
    color: 'bg-red-500',
    textColor: 'text-white',
    hoverColor: 'hover:bg-red-600',
    label: 'High',
  },
  medium: {
    color: 'bg-orange-500',
    textColor: 'text-white',
    hoverColor: 'hover:bg-orange-600',
    label: 'Medium',
  },
  low: {
    color: 'bg-green-500',
    textColor: 'text-white',
    hoverColor: 'hover:bg-green-600',
    label: 'Low',
  },
};

const sizeConfig = {
  sm: 'h-2 w-2 text-xs',
  md: 'h-3 w-3 text-sm',
  lg: 'h-4 w-4 text-base',
};

const PriorityBadge: React.FC<PriorityBadgeProps> = ({
  priority,
  size = 'md',
  showLabel = false,
  onClick,
  className,
}) => {
  const config = priorityConfig[priority];
  const sizeClass = sizeConfig[size];

  if (showLabel) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
          config.color,
          config.textColor,
          onClick && 'cursor-pointer',
          onClick && config.hoverColor,
          'transition-colors duration-200',
          className
        )}
        onClick={onClick}
      >
        <div className={cn('rounded-full', sizeClass)} />
        {config.label}
      </span>
    );
  }

  return (
    <div
      className={cn(
        'rounded-full',
        config.color,
        sizeClass,
        onClick && 'cursor-pointer',
        onClick && config.hoverColor,
        'transition-colors duration-200',
        className
      )}
      onClick={onClick}
      title={`Priority: ${config.label}`}
    />
  );
};

export default PriorityBadge; 