import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { APP_NAME, isConfigured } from "../lib/config";
import { useAuth } from "../lib/auth";
import { analyticsConsent, setAnalyticsConsent } from "../lib/analytics";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 text-ink" aria-label={`${APP_NAME} home`}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="currentColor" /><path d="M9 22c3-9 11-9 14-12M11 10l10 12" stroke="#f5f2ec" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>
      <span className="font-display text-[26px] leading-none">{APP_NAME}</span>
    </Link>
  );
}

function ConsentBanner() {
  const [open, setOpen] = useState(() => analyticsConsent() === null);
  if (!open) return null;
  return (
    <div role="region" aria-label="Privacy choices" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card">
      <div className="container-x flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14px] text-ink-2">
          We use essential storage to keep you signed in. With your OK, we also count anonymous product usage to improve {APP_NAME}. No ads, no tracking across sites.{" "}
          <Link to="/cookies" className="underline">Cookie policy</Link>
        </p>
        <div className="flex gap-2">
          <button className="btn-secondary min-h-10 px-4" onClick={() => { setAnalyticsConsent("denied"); setOpen(false); }}>Essential only</button>
          <button className="btn-primary min-h-10 px-4" onClick={() => { setAnalyticsConsent("granted"); setOpen(false); }}>Allow analytics</button>
        </div>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { session, isVerified, profile } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  const navCls = ({ isActive }: { isActive: boolean }) => `px-2 py-2 text-[14px] ${isActive ? "text-ink underline underline-offset-4" : "text-ink-2 hover:text-ink"}`;
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">Skip to content</a>
      {!isConfigured && (
        <div role="status" className="bg-warn px-4 py-2 text-center text-[13px] text-white">
          Backend not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. The site renders, but uploads and generation are disabled.
        </div>
      )}
      <header className="no-print border-b border-line/70">
        <div className="container-x flex h-16 items-center justify-between">
          <Logo />
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-3">
            <NavLink to="/pricing" className={navCls}>Pricing</NavLink>
            {session && isVerified ? (
              <>
                {profile?.is_admin && <NavLink to="/admin" className={navCls}>Admin</NavLink>}
                <NavLink to="/account" className={navCls}>My styles</NavLink>
              </>
            ) : (
              <NavLink to="/signin" className={navCls}>Sign in</NavLink>
            )}
            <Link to="/start" className="btn-primary ml-1 hidden min-h-10 px-4 sm:inline-flex">Try 3 free styles</Link>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="no-print mt-20 border-t border-line/70 py-10 text-[14px] text-muted">
        <div className="container-x flex flex-col gap-6 sm:flex-row sm:justify-between">
          <div className="max-w-md space-y-2">
            <Logo />
            <p>Personalised hairstyle concepts and a clear Hairstyle Card to take to your barber or stylist. Images are AI-generated visual concepts, not a guarantee of the final cut.</p>
          </div>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/privacy" className="hover:text-ink">Privacy</Link>
            <Link to="/terms" className="hover:text-ink">Terms</Link>
            <Link to="/cookies" className="hover:text-ink">Cookies</Link>
            <Link to="/pricing" className="hover:text-ink">Pricing</Link>
          </nav>
        </div>
      </footer>
      <ConsentBanner />
    </div>
  );
}
