import { useEffect, useRef, useState } from 'react';

interface PilotProgramModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type FormState = 'form' | 'submitting' | 'success' | 'error';

interface FormData {
  name: string;
  email: string;
  company: string;
  role: string;
  interest: string;
}

// Google Form configuration
// To get these entry IDs:
// 1. Open your Google Form in edit mode
// 2. Click the 3 dots menu → Get pre-filled link
// 3. Fill in sample data and click "Get link"
// 4. The URL will contain entry.XXXXXXXXX=value for each field
// 5. Replace the entry IDs below with your actual entry IDs
const GOOGLE_FORM_CONFIG = {
  formId: '1FAIpQLSfXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', // Replace with your form ID
  entryIds: {
    name: 'entry.XXXXXXXXX', // Replace with actual entry ID for Name field
    email: 'entry.XXXXXXXXX', // Replace with actual entry ID for Email field
    company: 'entry.XXXXXXXXX', // Replace with actual entry ID for Company field
    role: 'entry.XXXXXXXXX', // Replace with actual entry ID for Role field
    interest: 'entry.XXXXXXXXX', // Replace with actual entry ID for Interest field
  },
};

export default function PilotProgramModal({ isOpen, onClose }: PilotProgramModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [formState, setFormState] = useState<FormState>('form');
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    company: '',
    role: '',
    interest: '',
  });

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      // Reset after animation
      const timer = setTimeout(() => {
        setFormState('form');
        setFormData({ name: '', email: '', company: '', role: '', interest: '' });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormState('submitting');

    try {
      // Build form data for Google Forms submission
      const googleFormData = new FormData();
      googleFormData.append(GOOGLE_FORM_CONFIG.entryIds.name, formData.name);
      googleFormData.append(GOOGLE_FORM_CONFIG.entryIds.email, formData.email);
      googleFormData.append(GOOGLE_FORM_CONFIG.entryIds.company, formData.company);
      googleFormData.append(GOOGLE_FORM_CONFIG.entryIds.role, formData.role);
      googleFormData.append(GOOGLE_FORM_CONFIG.entryIds.interest, formData.interest);

      // Submit to Google Forms using no-cors mode (fire and forget)
      // Google Forms doesn't support CORS, so we can't get a response
      // but the submission will still go through
      await fetch(
        `https://docs.google.com/forms/d/e/${GOOGLE_FORM_CONFIG.formId}/formResponse`,
        {
          method: 'POST',
          mode: 'no-cors',
          body: googleFormData,
        }
      );

      // Since we can't verify the response due to CORS, assume success
      setFormState('success');
    } catch (error) {
      console.error('Form submission error:', error);
      setFormState('error');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 backdrop-blur-sm animate-fade-in p-lg"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="relative bg-surface rounded-md shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-2xl animate-slide-up"
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

        {/* Success State */}
        {formState === 'success' && (
          <div className="text-center py-xl">
            {/* Success Icon */}
            <div className="flex justify-center mb-lg">
              <div className="w-20 h-20 rounded-full bg-success/10 flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" className="text-success">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              </div>
            </div>

            <h2 className="text-heading-lg font-semibold text-foreground mb-md">
              You&apos;re on the List!
            </h2>

            <p className="text-foreground-muted text-body mb-lg leading-relaxed">
              Thank you for joining the WheelPath pilot program, <span className="font-medium text-foreground">{formData.name}</span>! 
              We&apos;ll reach out to <span className="font-medium text-foreground">{formData.email}</span> soon with next steps.
            </p>

            <div className="bg-terracotta-light rounded-md p-lg mb-xl">
              <p className="text-foreground text-body-sm">
                <span className="font-semibold">What happens next?</span>
                <br />
                Our team will review your application and contact you within 48 hours to schedule an onboarding call.
              </p>
            </div>

            <button onClick={onClose} className="btn-primary">
              Got it, thanks!
            </button>
          </div>
        )}

        {/* Error State */}
        {formState === 'error' && (
          <div className="text-center py-xl">
            {/* Error Icon */}
            <div className="flex justify-center mb-lg">
              <div className="w-20 h-20 rounded-full bg-error/10 flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" className="text-error">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                </svg>
              </div>
            </div>

            <h2 className="text-heading-lg font-semibold text-foreground mb-md">
              Something went wrong
            </h2>

            <p className="text-foreground-muted text-body mb-xl leading-relaxed">
              We couldn&apos;t submit your application. Please try again or contact us directly at{' '}
              <a href="mailto:pilot@wheelpath.ai" className="text-terracotta hover:underline">
                pilot@wheelpath.ai
              </a>
            </p>

            <div className="flex gap-md justify-center">
              <button onClick={() => setFormState('form')} className="btn-secondary">
                Try Again
              </button>
              <a
                href="https://forms.gle/xEzrQJDmKhdPYbmr5"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >
                Use Google Form
              </a>
            </div>
          </div>
        )}

        {/* Form State */}
        {(formState === 'form' || formState === 'submitting') && (
          <>
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
              className="text-heading-lg font-semibold text-foreground text-center mb-sm"
            >
              Be the First to Access
            </h2>

            <p className="text-foreground-muted text-body text-center mb-xl">
              Join our exclusive pilot program for construction teams.
            </p>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-lg">
              {/* Name */}
              <div>
                <label htmlFor="name" className="block text-body-sm font-medium text-foreground mb-xs">
                  Full Name <span className="text-terracotta">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="John Smith"
                  className="input-modern"
                  disabled={formState === 'submitting'}
                />
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-body-sm font-medium text-foreground mb-xs">
                  Work Email <span className="text-terracotta">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="john@company.com"
                  className="input-modern"
                  disabled={formState === 'submitting'}
                />
              </div>

              {/* Company */}
              <div>
                <label htmlFor="company" className="block text-body-sm font-medium text-foreground mb-xs">
                  Company <span className="text-terracotta">*</span>
                </label>
                <input
                  type="text"
                  id="company"
                  name="company"
                  required
                  value={formData.company}
                  onChange={handleInputChange}
                  placeholder="Acme Construction"
                  className="input-modern"
                  disabled={formState === 'submitting'}
                />
              </div>

              {/* Role */}
              <div>
                <label htmlFor="role" className="block text-body-sm font-medium text-foreground mb-xs">
                  Your Role <span className="text-terracotta">*</span>
                </label>
                <select
                  id="role"
                  name="role"
                  required
                  value={formData.role}
                  onChange={handleInputChange}
                  className="input-modern cursor-pointer"
                  disabled={formState === 'submitting'}
                >
                  <option value="">Select your role...</option>
                  <option value="Project Manager">Project Manager</option>
                  <option value="Project Engineer">Project Engineer</option>
                  <option value="Superintendent">Superintendent</option>
                  <option value="Estimator">Estimator</option>
                  <option value="Executive">Executive / Owner</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              {/* Interest / Message */}
              <div>
                <label htmlFor="interest" className="block text-body-sm font-medium text-foreground mb-xs">
                  What interests you most about WheelPath?
                </label>
                <textarea
                  id="interest"
                  name="interest"
                  rows={3}
                  value={formData.interest}
                  onChange={handleInputChange}
                  placeholder="Tell us about your document management challenges..."
                  className="input-modern resize-none"
                  disabled={formState === 'submitting'}
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={formState === 'submitting'}
                className="btn-accent w-full flex items-center justify-center gap-sm"
              >
                {formState === 'submitting' ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Submitting...
                  </>
                ) : (
                  <>
                    Join the Pilot Program
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            {/* Footer note */}
            <p className="text-foreground-subtle text-caption text-center mt-lg">
              Limited spots available • No commitment required
            </p>
          </>
        )}
      </div>
    </div>
  );
}
