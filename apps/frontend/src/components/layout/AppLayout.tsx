import { ReactNode, useEffect } from 'react';
import AOS from 'aos';
import 'aos/dist/aos.css';
import { Header } from './Header';
import { Footer } from './Footer';

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
    <div className="flex min-h-screen flex-col">
      <div data-aos="fade-down">
        <Header />
      </div>
      <main className="flex-1" data-aos="fade-in">
        {children}
      </main>
      <div data-aos="fade-up">
        <Footer />
      </div>
    </div>
  );
}
