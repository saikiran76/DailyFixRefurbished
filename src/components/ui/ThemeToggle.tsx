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

interface ThemeToggleProps {
  variant?: "default" | "outline" | "secondary";
  showTooltip?: boolean;
}

const ThemeToggle = ({ variant = "outline", showTooltip = true }: ThemeToggleProps) => {
  const { theme, setTheme } = useTheme();

  const renderThemeIcon = () => {
    switch (theme) {
      case 'dark':
        return <Moon className="h-[1.2rem] w-[1.2rem]" />;
      case 'light':
        return <Sun className="h-[1.2rem] w-[1.2rem]" />;
      default:
        return <Monitor className="h-[1.2rem] w-[1.2rem]" />;
    }
  };

  // Determine button classes based on variant
  let buttonClasses = "";
  switch (variant) {
    case "secondary":
      buttonClasses = "bg-secondary text-secondary-foreground hover:bg-secondary/80";
      break;
    case "outline":
      buttonClasses = "border border-input bg-background hover:bg-accent hover:text-accent-foreground";
      break;
    default:
      buttonClasses = "";
  }

  const menuItem = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size="icon" 
          className={buttonClasses}
          aria-label="Toggle theme"
        >
          {renderThemeIcon()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8}>
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

  if (showTooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {menuItem}
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            Change theme
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return menuItem;
};

export default ThemeToggle; 