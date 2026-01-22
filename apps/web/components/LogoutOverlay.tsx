import { useEffect, useState } from 'react';

interface LogoutOverlayProps {
  isVisible: boolean;
  userName?: string;
  onComplete: () => void;
  redirectUrl?: string;
}

export default function LogoutOverlay({
  isVisible,
  userName,
  onComplete,
  redirectUrl = 'https://wheelpath.ai',
}: LogoutOverlayProps) {
  const [phase, setPhase] = useState<'entering' | 'visible' | 'exiting' | 'hidden'>('hidden');

  useEffect(() => {
    if (isVisible) {
      // Start entering
      setPhase('entering');

      // After enter animation, show message
      const enterTimer = setTimeout(() => {
        setPhase('visible');
      }, 100);

      // After 2 seconds, start exit animation
      const exitTimer = setTimeout(() => {
        setPhase('exiting');
      }, 2500);

      // After exit animation, clear storage and redirect
      const redirectTimer = setTimeout(() => {
        setPhase('hidden');
        onComplete();

        // Clear browser storage to ensure clean logout
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (e) {
          console.warn('Failed to clear storage:', e);
        }

        window.location.href = redirectUrl;
      }, 3200);

      return () => {
        clearTimeout(enterTimer);
        clearTimeout(exitTimer);
        clearTimeout(redirectTimer);
      };
    } else {
      setPhase('hidden');
    }
  }, [isVisible, onComplete, redirectUrl]);

  if (phase === 'hidden') return null;

  const firstName = userName?.split(' ')[0] || '';

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-all duration-500 ease-out
        ${phase === 'entering' ? 'opacity-0' : ''}
        ${phase === 'visible' ? 'opacity-100' : ''}
        ${phase === 'exiting' ? 'opacity-0' : ''}
      `}
      style={{
        background: 'linear-gradient(135deg, #FAF8F5 0%, #F5E6DC 100%)',
      }}
    >
      <div
        className={`text-center transform transition-all duration-500 ease-out
          ${phase === 'entering' ? 'scale-95 translate-y-4 opacity-0' : ''}
          ${phase === 'visible' ? 'scale-100 translate-y-0 opacity-100' : ''}
          ${phase === 'exiting' ? 'scale-95 -translate-y-4 opacity-0' : ''}
        `}
      >
        {/* Animated checkmark */}
        <div className="flex justify-center mb-xl">
          <div
            className={`w-24 h-24 rounded-full bg-terracotta flex items-center justify-center transform transition-all duration-700 ease-out delay-200
              ${phase === 'visible' ? 'scale-100' : 'scale-0'}
            `}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-all duration-500 delay-500 ${phase === 'visible' ? 'opacity-100' : 'opacity-0'}`}
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        {/* Thank you message */}
        <h1 className="text-heading-lg font-semibold text-foreground mb-md">
          {firstName ? `Thanks, ${firstName}!` : 'Thanks for visiting!'}
        </h1>

        <p className="text-foreground-muted text-body max-w-sm mx-auto mb-lg">
          You&apos;ve been signed out successfully. See you next time!
        </p>

        {/* Subtle loading indicator */}
        <div className="flex justify-center gap-xs">
          <span
            className="w-2 h-2 bg-terracotta rounded-full animate-pulse"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-2 h-2 bg-terracotta rounded-full animate-pulse"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="w-2 h-2 bg-terracotta rounded-full animate-pulse"
            style={{ animationDelay: '300ms' }}
          />
        </div>

        <p className="text-foreground-subtle text-caption mt-lg">Redirecting to wheelpath.ai...</p>
      </div>
    </div>
  );
}
