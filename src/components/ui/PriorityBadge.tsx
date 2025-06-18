import React from 'react';
import { Badge } from '@/components/ui/badge';
import { priorityService, type Priority } from '@/services/priorityService';
import { cn } from '@/lib/utils';

interface PriorityBadgeProps {
  priority: Priority;
  onClick?: () => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const PriorityBadge: React.FC<PriorityBadgeProps> = ({ 
  priority, 
  onClick, 
  className,
  size = 'sm',
  showLabel = true
}) => {
  const getBadgeClasses = () => {
    const baseClasses = "font-medium transition-all duration-200 border-0";
    
    const sizeClasses = {
      sm: "text-xs px-2 py-0.5 rounded-full",
      md: "text-sm px-3 py-1 rounded-lg", 
      lg: "text-base px-4 py-1.5 rounded-lg"
    };

    const colorClasses = {
      high: "bg-red-500 hover:bg-red-600 text-white shadow-red-200 dark:shadow-red-900",
      medium: "bg-orange-500 hover:bg-orange-600 text-white shadow-orange-200 dark:shadow-orange-900", 
      low: "bg-green-500 hover:bg-green-600 text-white shadow-green-200 dark:shadow-green-900"
    };

    const shadowClass = onClick ? "shadow-lg hover:shadow-xl cursor-pointer" : "shadow-sm";
    
    return cn(
      baseClasses,
      sizeClasses[size],
      colorClasses[priority],
      shadowClass,
      onClick && "hover:scale-105 active:scale-95",
      className
    );
  };

  const label = showLabel ? priorityService.getPriorityLabel(priority) : '';
  const displayText = showLabel ? `${label} Priority` : '';

  return (
    <Badge
      variant="secondary"
      className={getBadgeClasses()}
      onClick={onClick}
      style={{
        backgroundColor: priorityService.getPriorityColor(priority),
        color: 'white'
      }}
    >
      {displayText || (
        <div className={cn("w-2 h-2 rounded-full", priorityService.getPriorityBgColor(priority))} />
      )}
    </Badge>
  );
};

export default PriorityBadge; 