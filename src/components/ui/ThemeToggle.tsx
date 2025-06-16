
import React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/providers/ThemeProvider';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';

interface ThemeToggleProps {
  variant?: "default" | "outline" | "secondary";
  showTooltip?: boolean;
}

const ThemeToggle = ({ variant = "outline", showTooltip = true }: ThemeToggleProps) => {
  const { theme, setTheme } = useTheme();
  const isMobile = useIsMobile();

  const renderThemeIcon = () => {
    switch (theme) {
      case 'dark':
        return <Moon className="h-4 w-4" />;
      case 'light':
        return <Sun className="h-4 w-4" />;
      default:
        return <Monitor className="h-4 w-4" />;
    }
  };

  // Updated button classes for theme consistency
  const buttonClasses = `flex items-center ${isMobile ? 'justify-start w-full gap-2 px-3' : 'justify-center'} h-9 ${isMobile ? 'w-full' : 'w-9'} rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors ${isMobile ? '' : 'mx-auto'} border-0 bg-transparent`;

  const menuItem = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button 
          className={buttonClasses}
          aria-label="Toggle theme"
        >
          {renderThemeIcon()}
          {isMobile && <span className="text-sm">Change theme</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        sideOffset={8}
        className="bg-popover border-border z-50"
      >
        <DropdownMenuItem onSelect={() => setTheme("light")}>
          <Sun className="mr-2 h-4 w-4" />
          <span>Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}>
          <Moon className="mr-2 h-4 w-4" />
          <span>Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          <Monitor className="mr-2 h-4 w-4" />
          <span>System</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (showTooltip && !isMobile) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {menuItem}
          </TooltipTrigger>
          <TooltipContent 
            side="right" 
            sideOffset={8}
            className="bg-popover border-border"
          >
            Change theme
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return menuItem;
};

export default ThemeToggle;
