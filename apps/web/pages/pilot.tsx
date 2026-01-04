import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';

import { useAuth } from '../lib/auth';

export default function Pilot() {
  const router = useRouter();
  const { user, signInWithGoogle } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    role: '',
    specialty: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  // Redirect to app when user is authenticated (not anonymous)
  useEffect(() => {
    if (user && !user.isAnonymous) {
      router.push('/app');
    }
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement form submission (e.g., to Firestore, email service, or API)
    console.log('Pilot program application:', formData);
    setSubmitted(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const specialties = [
    'Concrete',
    'Masonry',
    'Steel',
    'Carpentry',
    'Glass & Glazing',
    'Fire Suppression',
    'Plumbing',
    'HVAC',
    'Electrical',
    'Earthwork',
  ];

  return (
    <div 
      className="min-h-screen font-sans overflow-x-hidden"
      style={{
        background: 'linear-gradient(180deg, #1A1612 0%, #2C2419 100%)',
      }}
    >
      {/* Navigation */}
      <nav className="flex items-center justify-between px-lg md:px-3xl py-xl">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-sm hover:opacity-80 transition-opacity cursor-pointer"
        >
          <div className="w-10 h-10 rounded-md bg-gradient-to-br from-terracotta to-amber flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeWidth="2" stroke="white" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-heading font-semibold text-voice-text">WheelPath</span>
        </button>
        
        {/* Sign In Button */}
        <button
          onClick={signInWithGoogle}
          className="bg-terracotta text-white font-semibold px-xl py-md rounded-md
                     shadow-md hover:shadow-lg hover:bg-terracotta-dark transition-all duration-300
                     flex items-center gap-sm"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Sign In
        </button>
      </nav>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-lg md:px-3xl py-4xl">
        {/* Header */}
        <div className="text-center mb-4xl">
          <h1 className="text-display-xl font-semibold text-voice-text mb-lg">
            The Pilot Program
          </h1>
          <div className="w-24 h-1 bg-gradient-to-r from-terracotta to-amber mx-auto mb-3xl"></div>
        </div>

        {!submitted ? (
          <div className="grid md:grid-cols-2 gap-3xl">
            {/* Left Column - Description */}
            <div className="space-y-3xl">
              {/* Description */}
              <div>
                <h2 className="text-heading-lg font-semibold text-transparent bg-clip-text bg-gradient-to-r from-terracotta to-amber mb-lg">
                  Description
                </h2>
                <p className="text-body text-voice-muted leading-relaxed">
                  The WheelPath Pilot is a 60-day field test for specialty contractors who want faster, 
                  clearer jobsite communication. Participants will get access to our AI-powered tool built 
                  to simplify updates, reduce rework, and provide feedback that shapes the final product.
                </p>
                <p className="text-body text-voice-muted leading-relaxed mt-lg">
                  Complete the form and we'll share all the details.
                </p>
              </div>

              {/* Qualifications */}
              <div>
                <h2 className="text-heading-lg font-semibold text-transparent bg-clip-text bg-gradient-to-r from-terracotta to-amber mb-lg">
                  Qualifications
                </h2>
                <p className="text-body text-voice-muted mb-lg">
                  This pilot is designed for specialty commercial contractors in:
                </p>
                <div className="grid grid-cols-2 gap-sm">
                  {specialties.map((specialty) => (
                    <div 
                      key={specialty}
                      className="flex items-center gap-sm"
                    >
                      <div 
                        className="w-3 h-3 bg-terracotta"
                        style={{
                          clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
                        }}
                      />
                      <span className="text-body-sm text-voice-text">{specialty}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Users */}
              <div>
                <h3 className="text-heading font-semibold text-voice-text mb-sm">Users:</h3>
                <ul className="space-y-sm text-body text-voice-muted">
                  <li className="flex items-start gap-sm">
                    <span className="text-terracotta mt-1">•</span>
                    <span>Field teams managing RFIs, design changes, or install coordination</span>
                  </li>
                  <li className="flex items-start gap-sm">
                    <span className="text-terracotta mt-1">•</span>
                    <span>Foremen, PM's, or Ops leads on active projects</span>
                  </li>
                  <li className="flex items-start gap-sm">
                    <span className="text-terracotta mt-1">•</span>
                    <span className="italic">If you can send a text or make a phone call - you can operate WheelPath AI</span>
                  </li>
                </ul>
              </div>

              {/* Tagline */}
              <div className="pt-lg border-t border-voice-surface">
                <p className="text-heading-lg font-semibold text-transparent bg-clip-text bg-gradient-to-r from-terracotta to-amber">
                  Get Clarity | Go Build
                </p>
              </div>
            </div>

            {/* Right Column - Form */}
            <div>
              <div className="bg-voice-surface/50 backdrop-blur-sm rounded-lg p-xl border border-voice-surface">
                <h2 className="text-heading-lg font-semibold text-voice-text mb-xl">
                  Apply Now
                </h2>
                
                <form onSubmit={handleSubmit} className="space-y-lg">
                  {/* Name */}
                  <div>
                    <label htmlFor="name" className="block text-body-sm font-medium text-voice-text mb-sm">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      required
                      value={formData.name}
                      onChange={handleChange}
                      className="w-full bg-voice-bg border border-voice-surface rounded-md px-lg py-md text-body text-voice-text
                                 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta
                                 placeholder:text-voice-muted/50"
                      placeholder="John Smith"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label htmlFor="email" className="block text-body-sm font-medium text-voice-text mb-sm">
                      Email *
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      required
                      value={formData.email}
                      onChange={handleChange}
                      className="w-full bg-voice-bg border border-voice-surface rounded-md px-lg py-md text-body text-voice-text
                                 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta
                                 placeholder:text-voice-muted/50"
                      placeholder="john@company.com"
                    />
                  </div>

                  {/* Company */}
                  <div>
                    <label htmlFor="company" className="block text-body-sm font-medium text-voice-text mb-sm">
                      Company *
                    </label>
                    <input
                      type="text"
                      id="company"
                      name="company"
                      required
                      value={formData.company}
                      onChange={handleChange}
                      className="w-full bg-voice-bg border border-voice-surface rounded-md px-lg py-md text-body text-voice-text
                                 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta
                                 placeholder:text-voice-muted/50"
                      placeholder="ABC Construction"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label htmlFor="phone" className="block text-body-sm font-medium text-voice-text mb-sm">
                      Phone *
                    </label>
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      required
                      value={formData.phone}
                      onChange={handleChange}
                      className="w-full bg-voice-bg border border-voice-surface rounded-md px-lg py-md text-body text-voice-text
                                 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta
                                 placeholder:text-voice-muted/50"
                      placeholder="(555) 123-4567"
                    />
                  </div>

                  {/* Role */}
                  <div>
                    <label htmlFor="role" className="block text-body-sm font-medium text-voice-text mb-sm">
                      Role *
                    </label>
                    <input
                      type="text"
                      id="role"
                      name="role"
                      required
                      value={formData.role}
                      onChange={handleChange}
                      className="w-full bg-voice-bg border border-voice-surface rounded-md px-lg py-md text-body text-voice-text
                                 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta
                                 placeholder:text-voice-muted/50"
                      placeholder="Foreman, PM, Ops Lead, etc."
                    />
                  </div>

                  {/* Specialty */}
                  <div>
                    <label htmlFor="specialty" className="block text-body-sm font-medium text-voice-text mb-sm">
                      Specialty Trade *
                    </label>
                    <select
                      id="specialty"
                      name="specialty"
                      required
                      value={formData.specialty}
                      onChange={handleChange}
                      className="w-full bg-voice-bg border border-voice-surface rounded-md px-lg py-md text-body text-voice-text
                                 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta"
                    >
                      <option value="">Select your specialty</option>
                      {specialties.map((specialty) => (
                        <option key={specialty} value={specialty}>
                          {specialty}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Message */}
                  <div>
                    <label htmlFor="message" className="block text-body-sm font-medium text-voice-text mb-sm">
                      Tell us about your project (optional)
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      rows={4}
                      value={formData.message}
                      onChange={handleChange}
                      className="w-full bg-voice-bg border border-voice-surface rounded-md px-lg py-md text-body text-voice-text
                                 focus:border-terracotta focus:outline-none focus:ring-1 focus:ring-terracotta
                                 placeholder:text-voice-muted/50 resize-none"
                      placeholder="Project type, timeline, team size, etc."
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    className="w-full bg-gradient-to-r from-terracotta to-amber text-white font-semibold py-lg rounded-md
                               hover:shadow-lg hover:scale-[1.02] transition-all duration-300
                               flex items-center justify-center gap-sm"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Submit Application
                  </button>
                </form>
              </div>
            </div>
          </div>
        ) : (
          // Success Message
          <div className="text-center py-4xl">
            <div 
              className="w-24 h-24 mx-auto mb-xl bg-gradient-to-br from-terracotta to-amber flex items-center justify-center rounded-full"
              style={{
                clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
              }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-display font-semibold text-voice-text mb-lg">
              Application Received!
            </h2>
            <p className="text-body-lg text-voice-muted max-w-xl mx-auto mb-3xl">
              Thank you for your interest in the WheelPath Pilot Program. We'll review your application 
              and reach out within 2-3 business days with next steps.
            </p>
            <button
              onClick={() => router.push('/')}
              className="bg-terracotta text-white font-semibold px-3xl py-lg rounded-md
                         hover:bg-terracotta-dark transition-all duration-300"
            >
              Back to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

