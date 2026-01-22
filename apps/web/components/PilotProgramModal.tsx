import { useEffect, useRef } from 'react';

interface PilotProgramModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PilotProgramModal({ isOpen, onClose }: PilotProgramModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  // Close when clicking backdrop
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 backdrop-blur-sm animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="relative bg-surface rounded-md shadow-xl max-w-md w-full mx-lg p-2xl animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-lg right-lg p-xs rounded hover:bg-terracotta-light text-foreground-muted hover:text-terracotta transition-all"
          aria-label="Close modal"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>

        {/* Icon */}
        <div className="flex justify-center mb-lg">
          <div className="w-16 h-16 rounded-full bg-terracotta-light flex items-center justify-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-terracotta"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
        </div>

        {/* Header */}
        <h2
          id="modal-title"
          className="text-heading-lg font-semibold text-foreground text-center mb-md"
        >
          Be the First to Access
        </h2>

        {/* Description */}
        <p className="text-foreground-muted text-body text-center mb-xl leading-relaxed">
          WheelPath is currently in our exclusive pilot program. Join forward-thinking construction
          teams who are transforming how they handle RFIs and project documents.
        </p>

        {/* Benefits list */}
        <div className="space-y-sm mb-xl">
          {[
            'Early access to AI-powered document intelligence',
            'Direct input on features that matter to you',
            'Priority support from our founding team',
          ].map((benefit, i) => (
            <div key={i} className="flex items-start gap-sm">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-terracotta shrink-0 mt-0.5"
              >
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
              <span className="text-foreground-muted text-body-sm">{benefit}</span>
            </div>
          ))}
        </div>

        {/* CTA Button */}
        <a
          href="https://forms.gle/xEzrQJDmKhdPYbmr5"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-accent w-full flex items-center justify-center gap-sm"
        >
          Join the Pilot Program
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
          </svg>
        </a>

        {/* Footer note */}
        <p className="text-foreground-subtle text-caption text-center mt-lg">
          Limited spots available • No commitment required
        </p>
      </div>
    </div>
  );
}
