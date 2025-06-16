
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type Theme = "dark" | "light" | "system";

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "dark" | "light";
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  resolvedTheme: "dark",
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "dailyfix-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );
  
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const root = window.document.documentElement;
    
    // Remove existing theme classes
    root.classList.remove("light", "dark");

    let newResolvedTheme: "dark" | "light";
    
    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      newResolvedTheme = systemTheme;
    } else {
      newResolvedTheme = theme;
    }

    // Apply the resolved theme
    root.classList.add(newResolvedTheme);
    setResolvedTheme(newResolvedTheme);
    
    console.log('[ThemeProvider] Applied theme:', newResolvedTheme);

    // Listen for system theme changes if using system theme
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = () => {
      const currentTheme = localStorage.getItem(storageKey) as Theme;
      if (currentTheme === 'system') {
        root.classList.remove('light', 'dark');
        const newSystemTheme = mediaQuery.matches ? 'dark' : 'light';
        root.classList.add(newSystemTheme);
        setResolvedTheme(newSystemTheme);
        console.log('[ThemeProvider] System theme changed to:', newSystemTheme);
      }
    };
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
    
  }, [theme, storageKey]);

  const value = {
    theme,
    resolvedTheme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};

export default ThemeProvider;