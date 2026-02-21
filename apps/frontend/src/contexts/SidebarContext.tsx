import { createContext, useContext, useState, ReactNode } from 'react';

type SidebarState = 'expanded' | 'collapsed';

interface SidebarContextValue {
  state: SidebarState;
  toggle: () => void;
  mobileOpen: boolean;
  toggleMobile: () => void;
  closeMobile: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  state: 'expanded',
  toggle: () => {},
  mobileOpen: false,
  toggleMobile: () => {},
  closeMobile: () => {},
});

const STORAGE_KEY = 'sidebar_state';

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SidebarState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'collapsed' ? 'collapsed' : 'expanded';
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = () => {
    setState((prev) => {
      const next = prev === 'expanded' ? 'collapsed' : 'expanded';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  };

  return (
    <SidebarContext.Provider
      value={{
        state,
        toggle,
        mobileOpen,
        toggleMobile: () => setMobileOpen((p) => !p),
        closeMobile: () => setMobileOpen(false),
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
