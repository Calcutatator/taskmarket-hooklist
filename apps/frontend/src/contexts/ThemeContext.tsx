import { createContext, useContext, ReactNode } from 'react';
import { useThemeMode } from '@/hooks/useThemeMode';

interface ThemeContextValue {
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { isDark, setIsDark } = useThemeMode();
  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme: () => setIsDark((p) => !p) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
