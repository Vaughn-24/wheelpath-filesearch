import { useState, useRef, useEffect } from 'react';
import { User } from 'firebase/auth';

interface UserMenuProps {
  user: User;
  onSignOut: () => void;
  size?: 'sm' | 'md';
}

export default function UserMenu({ user, onSignOut, size = 'md' }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close menu on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleSignOut = () => {
    setIsOpen(false);
    onSignOut();
  };

  const avatarSize = size === 'sm' ? 'h-8 w-8 text-body-sm' : 'h-10 w-10 text-body';
  const initial = user.email ? user.email[0].toUpperCase() : user.displayName?.[0]?.toUpperCase() || 'U';

  return (
    <div className="relative" ref={menuRef}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`${avatarSize} rounded-full bg-terracotta flex items-center justify-center text-white font-medium 
                   hover:bg-terracotta-dark transition-colors focus:outline-none focus:ring-2 focus:ring-terracotta focus:ring-offset-2 focus:ring-offset-background`}
        aria-expanded={isOpen}
        aria-haspopup="true"
        title={user.email || user.displayName || 'User menu'}
      >
        {initial}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 mt-sm w-64 bg-surface rounded-md shadow-lg border border-border py-sm z-50 animate-fade-in"
          role="menu"
          aria-orientation="vertical"
        >
          {/* User Info */}
          <div className="px-lg py-md border-b border-border">
            <p className="text-body-sm font-medium text-foreground truncate">
              {user.displayName || 'User'}
            </p>
            <p className="text-caption text-foreground-muted truncate">{user.email}</p>
          </div>

          {/* Menu Items */}
          <div className="py-xs">
            <button
              onClick={handleSignOut}
              className="w-full px-lg py-md text-left text-body-sm text-foreground hover:bg-terracotta-light hover:text-terracotta transition-colors flex items-center gap-sm"
              role="menuitem"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
