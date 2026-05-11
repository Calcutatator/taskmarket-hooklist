import { ReactNode, useEffect } from 'react';
import AOS from 'aos';
import 'aos/dist/aos.css';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { SidebarProvider } from '@/contexts/SidebarContext';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  useEffect(() => {
    AOS.init({
      duration: 500,
      offset: 50,
      easing: 'ease-in-out',
      once: true,
      anchorPlacement: 'top-bottom',
    });
  }, []);

  return (
    <SidebarProvider>
      <div className="flex min-h-[100dvh] overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
