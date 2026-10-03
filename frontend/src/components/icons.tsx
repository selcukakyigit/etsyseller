export function SunIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={`w-4 h-4 ${className}`}>
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </svg>
  );
}

export function MoonIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`w-4 h-4 ${className}`}>
      <path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a.5.5 0 00-.65-.62A9 9 0 1021.62 15.15a.5.5 0 00-.62-.65z" />
    </svg>
  );
}

export function SyncIcon({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={`w-4 h-4 ${className}`} style={style}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8 8 0 00-14.9-4M4 5v5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 13a8 8 0 0014.9 4M20 19v-5h-5" />
    </svg>
  );
}

export function BellIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={`w-4 h-4 ${className}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}

export function UserIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={`w-5 h-5 ${className}`}>
      <circle cx="12" cy="8" r="4" />
      <path strokeLinecap="round" d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  );
}

export function KeyIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={`w-5 h-5 ${className}`}>
      <circle cx="8" cy="15" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 12l8-8M15 4l3 3M19 8l3 3" />
    </svg>
  );
}

export function DocumentIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={`w-5 h-5 ${className}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 16h6" />
    </svg>
  );
}

export function StoreIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={`w-5 h-5 ${className}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9l1-5h14l1 5M4 9a2 2 0 004 0 2 2 0 004 0 2 2 0 004 0 2 2 0 004 0M5 9v10h14V9" />
    </svg>
  );
}

export function ShieldIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={`w-5 h-5 ${className}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    </svg>
  );
}

export function HelpIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={`w-5 h-5 ${className}`}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 1.8-2.5 3.5" />
      <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ChevronRightIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 ${className}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
    </svg>
  );
}

// Mobil gezinme (components/layout) ikonları
const navIcon = (d: string) =>
  function NavIcon({ className = "" }: { className?: string }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`h-5 w-5 ${className}`} aria-hidden>
        <path d={d} />
      </svg>
    );
  };

export const HomeIcon = navIcon("M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9.5z");
export const BoxIcon = navIcon("M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8");
export const TagIcon = navIcon("M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01");
export const ChartIcon = navIcon("M4 20V10M10 20V4M16 20v-7M22 20H2");
export const MenuIcon = navIcon("M4 7h16M4 12h16M4 17h16");
export const CloseIcon = navIcon("M6 6l12 12M18 6L6 18");
