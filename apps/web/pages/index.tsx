import { useRouter } from 'next/router';
import { useEffect, useState, useRef } from 'react';

import { useAuth } from '../lib/auth';

export default function Landing() {
  const router = useRouter();
  const { user, loading, signInWithGoogle } = useAuth();
  const [mounted, setMounted] = useState(false);

  // Scroll-based animation state
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [orbState, setOrbState] = useState<'hero' | 'floating'>('hero');
  const heroRef = useRef<HTMLElement>(null);
  const featuresRef = useRef<HTMLElement>(null);
  const connectionRef = useRef<HTMLElement>(null);

  // Bubble level: play once when Features section is in view
  const [bubbleHasStarted, setBubbleHasStarted] = useState(false);
  const [bubbleT, setBubbleT] = useState(0); // 0..1 timeline

  // Slotted connection: play when connection section is in view
  const [connectionHasStarted, setConnectionHasStarted] = useState(false);
  const [connectionT, setConnectionT] = useState(0); // 0..1 timeline
  const [chatInput, setChatInput] = useState('');

  // Torque lock CTA state
  const [ctaHovered, setCtaHovered] = useState(false);
  const [ctaClicked, setCtaClicked] = useState(false);

  // Rotating specialties for Features header
  const specialties = [
    'Construction Superintendents',
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
  const [currentSpecialtyIndex, setCurrentSpecialtyIndex] = useState(0);
  const [specialtyFading, setSpecialtyFading] = useState(false);

  // Intersection observer for reveal animations
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Scroll handler for parallax and orb effects
  useEffect(() => {
    if (!mounted) return;

    // Set initial viewport height
    setViewportHeight(window.innerHeight);

    const handleScroll = () => {
      const y = window.scrollY;
      setScrollY(y);

      // Transition orb to floating state after scrolling past hero
      const heroHeight = heroRef.current?.offsetHeight || 800;
      if (y > heroHeight * 0.6) {
        setOrbState('floating');
      } else {
        setOrbState('hero');
      }

      // Bubble animation: start when Features section is ~70% into view, reset when scrolled back up
      const featuresEl = featuresRef.current;
      if (featuresEl) {
        const top = featuresEl.getBoundingClientRect().top;
        const triggerY = window.innerHeight * 0.3; // top reaches 30% of viewport => ~70% "into view"
        const resetY = window.innerHeight * 0.7; // reset when scrolled back above this point

        // Start animation when scrolling into view
        if (!bubbleHasStarted && top <= triggerY) {
          setBubbleHasStarted(true);
          setBubbleT(0); // ensure we start from beginning
        }

        // Reset animation when scrolled back out of view (upward)
        if (bubbleHasStarted && top > resetY) {
          setBubbleHasStarted(false);
          setBubbleT(0);
        }
      }

      // Connection animation: start when connection section is ~70% into view, reset when scrolled back up
      const connectionEl = connectionRef.current;
      if (connectionEl) {
        const top = connectionEl.getBoundingClientRect().top;
        const triggerY = window.innerHeight * 0.3;
        const resetY = window.innerHeight * 0.7;

        if (!connectionHasStarted && top <= triggerY) {
          setConnectionHasStarted(true);
          setConnectionT(0);
        }

        if (connectionHasStarted && top > resetY) {
          setConnectionHasStarted(false);
          setConnectionT(0);
        }
      }
    };

    const handleResize = () => {
      setViewportHeight(window.innerHeight);
      handleScroll();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });

    // Trigger initial scroll calculation
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [mounted, bubbleHasStarted]);

  // Run bubble animation timeline once (not scrubbed by scroll)
  useEffect(() => {
    if (!bubbleHasStarted) return;
    if (bubbleT >= 1) return;

    const durationMs = 2200; // slow drift, then snap to center
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setBubbleT(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bubbleHasStarted]);

  // Run connection animation timeline
  useEffect(() => {
    if (!connectionHasStarted) return;
    if (connectionT >= 1) return;

    const durationMs = 1800; // slide + seat + settle
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setConnectionT(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [connectionHasStarted]);

  // Rotate specialties every 1.5 seconds
  useEffect(() => {
    if (!mounted) return;

    const interval = setInterval(() => {
      // Start fade out
      setSpecialtyFading(true);

      // After fade out completes, change text and fade in
      setTimeout(() => {
        setCurrentSpecialtyIndex((prev) => (prev + 1) % specialties.length);
        setSpecialtyFading(false);
      }, 300); // 300ms fade out duration
    }, 1500);

    return () => clearInterval(interval);
  }, [mounted, specialties.length]);

  // Intersection Observer for reveal animations
  useEffect(() => {
    if (!mounted) return;

    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              // Add staggered delay based on data attribute or index
              const delay = parseInt(
                entry.target.getAttribute('style')?.match(/transition-delay:\s*(\d+)ms/)?.[1] ||
                  '0',
              );
              setTimeout(() => {
                entry.target.classList.add('revealed');
              }, delay);
            }
          });
        },
        { threshold: 0.1, rootMargin: '50px 0px -20px 0px' },
      );

      // Observe all elements with reveal class
      document.querySelectorAll('.reveal-on-scroll').forEach((el) => {
        observerRef.current?.observe(el);
      });
    }, 100);

    return () => {
      clearTimeout(timer);
      observerRef.current?.disconnect();
    };
  }, [mounted]);

  // Redirect authenticated users to app (skip if ?preview=true for demo purposes)
  useEffect(() => {
    if (mounted && !loading && user && router.isReady && router.query.preview !== 'true') {
      router.push('/app');
    }
  }, [mounted, user, loading, router.isReady, router.query.preview]);

  // Calculate hexbolt rotation - 270° turn over hero section scroll
  const heroHeight = heroRef.current?.offsetHeight || viewportHeight;
  const orbRotation = Math.min((scrollY / heroHeight) * 270, 270); // Clockwise 270° turn, capped at 270°
  const orbScale = orbState === 'floating' ? 0.35 : 1;
  const orbOpacity = orbState === 'floating' ? 0.9 : 1;

  // Bubble level timeline mapping (one-shot animation)
  // Phase 1: drift (0-0.50)
  // Phase 2: center lock (0.50-0.75)
  // Phase 3: settle + confidence glow (0.75-1.0)
  const bubbleCentered = bubbleT >= 0.5;
  const bubbleLocked = bubbleT >= 0.75;

  // Bubble drift: starts left, drifts to center
  const bubbleDriftPhase = Math.min(1, bubbleT / 0.5);
  const bubbleX = bubbleCentered ? 50 : 30 + bubbleDriftPhase * 20; // 30% -> 50%

  // Ease into center with slight bounce
  const bubbleEase = bubbleCentered ? 1 - Math.pow(1 - Math.min(1, (bubbleT - 0.5) / 0.25), 3) : 0;
  const bubbleBounce = bubbleLocked ? 0 : Math.sin(bubbleEase * Math.PI) * 2;
  const bubbleFinalX = bubbleCentered ? 50 - bubbleBounce : bubbleX;

  // Color confidence: transparent -> amber (drift) -> terracotta/amber gradient (locked)
  const bubbleConfidence = bubbleLocked ? 1 : 0;
  const bubbleColor = bubbleLocked
    ? 'rgba(194, 112, 62, 0.85)' // terracotta when locked
    : `rgba(212, 160, 48, ${0.3 + bubbleDriftPhase * 0.3})`; // amber during drift

  // Tube glow when locked (brand color)
  const tubeGlow = bubbleLocked ? 1 : 0;

  // Cards reveal after bubble locks
  const cardsVisible = bubbleLocked;

  // Connection animation timeline mapping
  // Phase 1: slide together (0-0.55)
  // Phase 2: align and seat (0.55-0.75)
  // Phase 3: settle and reveal chat (0.75-1.0)
  const connectionSlidePhase = Math.min(1, connectionT / 0.55);
  const connectionSeated = connectionT >= 0.55;
  const connectionSettled = connectionT >= 0.75;

  // Left piece slides from -100% to 0%
  const leftX = connectionSeated ? 0 : -100 + connectionSlidePhase * 100;

  // Right piece slides from 100% to 0%
  const rightX = connectionSeated ? 0 : 100 - connectionSlidePhase * 100;

  // Seat effect: slight overshoot then settle
  const seatPhase =
    connectionSeated && !connectionSettled ? Math.min(1, (connectionT - 0.55) / 0.2) : 0;
  const seatOvershoot = Math.sin(seatPhase * Math.PI) * -3; // px

  // Chat interface reveal
  const chatRevealPhase = connectionSettled ? Math.min(1, (connectionT - 0.75) / 0.25) : 0;
  const chatOpacity = chatRevealPhase;
  const chatScale = 0.95 + chatRevealPhase * 0.05;

  // Show loading while checking auth
  if (!mounted || loading) {
    return (
      <div className="min-h-screen bg-voice-bg flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-terracotta border-t-transparent animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans text-voice-text overflow-x-hidden">
      {/* ===== FLOATING HEXBOLT COMPANION ===== */}
      <div
        className={`fixed z-50 transition-all duration-500 ease-out pointer-events-none
                    ${orbState === 'floating' ? 'opacity-100' : 'opacity-0'}`}
        style={{
          bottom: '24px',
          right: '24px',
          transform: `rotate(${orbRotation}deg)`,
          filter: 'drop-shadow(0 4px 12px rgba(194, 112, 62, 0.4))',
        }}
      >
        <div
          className="w-14 h-14 flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #C2703E 0%, #D4A030 100%)',
            clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="white"
            style={{ transform: `rotate(${-orbRotation}deg)` }}
          >
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        </div>
      </div>

      {/* ===== HERO SECTION ===== */}
      <section
        ref={heroRef}
        className="relative min-h-screen flex flex-col landing-hero overflow-hidden"
      >
        {/* Geometric Pattern Overlay */}
        <div className="absolute inset-0 landing-grid-pattern opacity-30"></div>

        {/* Parallax Floating Shapes */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* Large background orbs */}
          <div
            className="landing-orb-float absolute w-64 h-64 rounded-full blur-3xl opacity-20"
            style={{
              background: 'linear-gradient(135deg, #C2703E 0%, #D4A030 100%)',
              top: '20%',
              left: '15%',
              transform: `translateY(${scrollY * 0.3}px)`,
            }}
          />
          <div
            className="landing-orb-float-delayed absolute w-96 h-96 rounded-full blur-3xl opacity-10"
            style={{
              background: 'linear-gradient(135deg, #D4A030 0%, #C2703E 100%)',
              bottom: '10%',
              right: '10%',
              transform: `translateY(${scrollY * -0.2}px)`,
            }}
          />

          {/* Geometric Shapes - Hexagons and Triangles */}
          <div
            className="absolute opacity-10"
            style={{
              top: '15%',
              right: '20%',
              transform: `translateY(${scrollY * 0.4}px) rotate(${scrollY * 0.1}deg)`,
            }}
          >
            <svg
              width="60"
              height="60"
              viewBox="0 0 100 100"
              fill="none"
              stroke="#C2703E"
              strokeWidth="2"
            >
              <polygon points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5" />
            </svg>
          </div>
          <div
            className="absolute opacity-10"
            style={{
              top: '60%',
              left: '10%',
              transform: `translateY(${scrollY * -0.3}px) rotate(${-scrollY * 0.15}deg)`,
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 100 100"
              fill="none"
              stroke="#D4A030"
              strokeWidth="2"
            >
              <polygon points="50,10 90,90 10,90" />
            </svg>
          </div>
          <div
            className="absolute opacity-10"
            style={{
              top: '40%',
              right: '8%',
              transform: `translateY(${scrollY * 0.25}px) rotate(${scrollY * 0.2}deg)`,
            }}
          >
            <svg
              width="30"
              height="30"
              viewBox="0 0 100 100"
              fill="none"
              stroke="#C2703E"
              strokeWidth="2"
            >
              <rect x="10" y="10" width="80" height="80" rx="8" transform="rotate(45 50 50)" />
            </svg>
          </div>
          <div
            className="absolute opacity-8"
            style={{
              bottom: '25%',
              left: '25%',
              transform: `translateY(${scrollY * 0.35}px) rotate(${scrollY * -0.1}deg)`,
            }}
          >
            <svg
              width="50"
              height="50"
              viewBox="0 0 100 100"
              fill="none"
              stroke="#D4A030"
              strokeWidth="2"
            >
              <circle cx="50" cy="50" r="40" />
              <circle cx="50" cy="50" r="25" />
            </svg>
          </div>
        </div>

        {/* Navigation */}
        <nav className="relative z-10 flex items-center justify-between px-lg md:px-3xl py-xl">
          <div className="flex items-center gap-sm">
            {/* Logo Mark */}
            <div className="w-10 h-10 rounded-md bg-gradient-to-br from-terracotta to-amber flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path
                  d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  strokeWidth="2"
                  stroke="white"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="text-heading font-semibold text-voice-text">WheelPath</span>
          </div>

          {/* Torque Lock Sign In Button */}
          <button
            onClick={() => {
              setCtaClicked(true);
              setTimeout(() => signInWithGoogle(), 400);
            }}
            onMouseEnter={() => setCtaHovered(true)}
            onMouseLeave={() => setCtaHovered(false)}
            className="group relative bg-terracotta text-white font-semibold px-xl py-md rounded-md
                       shadow-md hover:shadow-lg transition-all duration-300 overflow-hidden"
            style={{
              transform: ctaClicked ? 'scale(0.98)' : ctaHovered ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            {/* Wrench Icon with Torque Animation */}
            <span className="inline-flex items-center gap-sm">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="transition-transform duration-500 ease-out"
                style={{
                  transform: ctaClicked
                    ? 'rotate(180deg) scale(0.9)'
                    : ctaHovered
                      ? 'rotate(45deg)'
                      : 'rotate(0deg)',
                }}
              >
                {/* Wrench icon */}
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
              <span>Sign In</span>
            </span>

            {/* Hex bolt fastener visual (appears on hover) */}
            <div
              className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background:
                  'radial-gradient(circle at center, rgba(255, 255, 255, 0.1) 0%, transparent 70%)',
              }}
            >
              {/* Hex bolts in corners */}
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 150 50"
                preserveAspectRatio="none"
                className="absolute inset-0"
              >
                {/* Top-left hex bolt */}
                <g transform="translate(8, 8)" opacity="0.4">
                  <polygon points="0,-3 2.5,-1.5 2.5,1.5 0,3 -2.5,1.5 -2.5,-1.5" fill="white" />
                  <circle cx="0" cy="0" r="0.8" fill="rgba(0,0,0,0.3)" />
                </g>

                {/* Top-right hex bolt */}
                <g transform="translate(142, 8)" opacity="0.4">
                  <polygon points="0,-3 2.5,-1.5 2.5,1.5 0,3 -2.5,1.5 -2.5,-1.5" fill="white" />
                  <circle cx="0" cy="0" r="0.8" fill="rgba(0,0,0,0.3)" />
                </g>

                {/* Bottom-left hex bolt */}
                <g transform="translate(8, 42)" opacity="0.4">
                  <polygon points="0,-3 2.5,-1.5 2.5,1.5 0,3 -2.5,1.5 -2.5,-1.5" fill="white" />
                  <circle cx="0" cy="0" r="0.8" fill="rgba(0,0,0,0.3)" />
                </g>

                {/* Bottom-right hex bolt */}
                <g transform="translate(142, 42)" opacity="0.4">
                  <polygon points="0,-3 2.5,-1.5 2.5,1.5 0,3 -2.5,1.5 -2.5,-1.5" fill="white" />
                  <circle cx="0" cy="0" r="0.8" fill="rgba(0,0,0,0.3)" />
                </g>
              </svg>
            </div>

            {/* Click ripple effect */}
            {ctaClicked && (
              <span
                className="absolute inset-0 rounded-md"
                style={{
                  background:
                    'radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, transparent 70%)',
                  animation: 'ping 0.4s ease-out',
                }}
              />
            )}
          </button>
        </nav>

        {/* Hero Content */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-lg md:px-3xl text-center">
          {/* Animated Hexbolt - Rolling Effect */}
          <div
            className="mb-3xl"
            style={{
              transform: `scale(${orbScale}) rotate(${orbRotation}deg)`,
              opacity: orbOpacity,
            }}
          >
            <div
              className="landing-hexbolt w-36 h-36 md:w-44 md:h-44 flex items-center justify-center relative"
              style={{
                background: 'linear-gradient(135deg, #C2703E 0%, #D4A030 100%)',
                clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
              }}
            >
              {/* Inner hexagon for depth */}
              <div
                className="w-28 h-28 md:w-36 md:h-36 flex items-center justify-center bg-white/10"
                style={{
                  clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
                }}
              >
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="white"
                  className="md:w-16 md:h-16"
                  style={{ transform: `rotate(${-orbRotation}deg)` }}
                >
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Headline */}
          <h1 className="landing-fade-in text-display md:text-display-xl font-semibold tracking-tight max-w-4xl mb-xl">
            Construction Intelligence,{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-terracotta to-amber">
              Conversational AI
            </span>
          </h1>

          {/* Subheadline */}
          <p className="landing-fade-in-delayed text-body-lg md:text-heading text-voice-muted max-w-2xl mb-3xl">
            We help specialty construction contractors instantly find critical project details —
            simply by text or phone call.
          </p>

          {/* CTA Buttons */}
          <div className="landing-fade-in-delayed-2 flex flex-col sm:flex-row gap-lg">
            {/* Get Started Free - Torque Lock CTA */}
            <button
              onClick={() => {
                setCtaClicked(true);
                setTimeout(() => signInWithGoogle(), 400);
              }}
              onMouseEnter={() => setCtaHovered(true)}
              onMouseLeave={() => setCtaHovered(false)}
              className="group relative bg-terracotta text-white font-semibold text-body-lg px-3xl py-lg rounded-md
                         shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden"
              style={{
                transform: ctaClicked ? 'scale(0.98)' : ctaHovered ? 'scale(1.05)' : 'scale(1)',
              }}
            >
              {/* Wrench Icon with Torque Animation */}
              <span className="inline-flex items-center gap-sm">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="transition-transform duration-500 ease-out"
                  style={{
                    transform: ctaClicked
                      ? 'rotate(180deg) scale(0.9)'
                      : ctaHovered
                        ? 'rotate(45deg)'
                        : 'rotate(0deg)',
                  }}
                >
                  {/* Wrench icon */}
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                <span>Get Started Free</span>
              </span>

              {/* Hex bolt fastener visual (appears on hover) */}
              <div
                className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background:
                    'radial-gradient(circle at center, rgba(255, 255, 255, 0.1) 0%, transparent 70%)',
                }}
              >
                {/* Hex bolts in corners */}
                <svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 300 80"
                  preserveAspectRatio="none"
                  className="absolute inset-0"
                >
                  {/* Top-left hex bolt */}
                  <g transform="translate(15, 15)" opacity="0.4">
                    <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="white" />
                    <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.3)" />
                  </g>

                  {/* Top-right hex bolt */}
                  <g transform="translate(285, 15)" opacity="0.4">
                    <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="white" />
                    <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.3)" />
                  </g>

                  {/* Bottom-left hex bolt */}
                  <g transform="translate(15, 65)" opacity="0.4">
                    <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="white" />
                    <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.3)" />
                  </g>

                  {/* Bottom-right hex bolt */}
                  <g transform="translate(285, 65)" opacity="0.4">
                    <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="white" />
                    <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.3)" />
                  </g>
                </svg>
              </div>

              {/* Click ripple effect */}
              {ctaClicked && (
                <span
                  className="absolute inset-0 rounded-md"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, transparent 70%)',
                    animation: 'ping 0.4s ease-out',
                  }}
                />
              )}
            </button>

            <button
              className="group flex items-center justify-center gap-sm px-3xl py-lg rounded-md border-2 border-voice-muted/30 text-voice-text
                         hover:border-terracotta hover:bg-voice-surface transition-all duration-base"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="group-hover:text-terracotta transition-colors"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              Watch Demo
            </button>
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="relative z-10 flex justify-center pb-xl">
          <button
            onClick={() => {
              featuresRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="animate-bounce cursor-pointer hover:text-terracotta transition-colors"
            aria-label="Scroll to features"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-voice-muted"
            >
              <path d="M7 13l5 5 5-5M7 6l5 5 5-5" />
            </svg>
          </button>
        </div>
      </section>

      {/* ===== FEATURES SECTION ===== */}
      <section ref={featuresRef} className="bg-background py-4xl px-lg md:px-3xl overflow-hidden">
        <div className="max-w-6xl mx-auto">
          {/* Hexagonal Torpedo Level (above Features header) */}
          <div className="pointer-events-none mb-2xl flex justify-center">
            <svg width="420" height="100" viewBox="0 0 420 100" aria-hidden="true">
              <defs>
                {/* Gradient for hex body - matches hero hexbolt */}
                <linearGradient id="hexBodyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#C2703E" />
                  <stop offset="100%" stopColor="#D4A030" />
                </linearGradient>

                {/* Liquid gradient */}
                <linearGradient id="bubbleLiquid" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(212, 160, 48, 0.20)" />
                  <stop offset="100%" stopColor="rgba(194, 112, 62, 0.25)" />
                </linearGradient>

                {/* Glow filter */}
                <filter id="tubeGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
                  <feFlood floodColor="#C2703E" floodOpacity={tubeGlow * 0.5} />
                  <feComposite in2="blur" operator="in" result="glow" />
                  <feMerge>
                    <feMergeNode in="glow" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Main hexagonal body */}
              <g>
                {/* Outer hex tube - main body */}
                <polygon
                  points="20,35 30,30 390,30 400,35 400,65 390,70 30,70 20,65"
                  fill="url(#hexBodyGradient)"
                  stroke="rgba(0,0,0,0.15)"
                  strokeWidth="1.5"
                  style={{
                    filter: bubbleLocked
                      ? 'url(#tubeGlow)'
                      : 'drop-shadow(0 2px 8px rgba(0,0,0,0.1))',
                  }}
                />

                {/* Top facet highlight */}
                <polygon
                  points="30,30 390,30 400,35 400,38 390,33 30,33 20,38"
                  fill="rgba(255,255,255,0.25)"
                />

                {/* Detail lines (construction markings) */}
                <line x1="70" y1="30" x2="70" y2="70" stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
                <line x1="350" y1="30" x2="350" y2="70" stroke="rgba(0,0,0,0.15)" strokeWidth="1" />

                {/* Glass viewport window (center hex cutout) - lengthened */}
                <polygon
                  points="120,40 135,35 285,35 300,40 300,60 285,65 135,65 120,60"
                  fill="rgba(255, 255, 255, 0.90)"
                  stroke="rgba(0, 0, 0, 0.20)"
                  strokeWidth="1.5"
                />

                {/* Liquid fill inside viewport */}
                <rect
                  x="125"
                  y="54"
                  width="170"
                  height="8"
                  fill="url(#bubbleLiquid)"
                  opacity={0.5 + bubbleDriftPhase * 0.2}
                />

                {/* Center mark (target line) */}
                <line
                  x1="210"
                  y1="32"
                  x2="210"
                  y2="68"
                  stroke="rgba(0, 0, 0, 0.25)"
                  strokeWidth="2"
                  strokeDasharray="4,3"
                />

                {/* Measurement hash marks */}
                <g opacity="0.4">
                  <line
                    x1="145"
                    y1="37"
                    x2="145"
                    y2="63"
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth="1"
                  />
                  <line
                    x1="175"
                    y1="38"
                    x2="175"
                    y2="62"
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth="0.5"
                  />
                  <line
                    x1="245"
                    y1="38"
                    x2="245"
                    y2="62"
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth="0.5"
                  />
                  <line
                    x1="275"
                    y1="37"
                    x2="275"
                    y2="63"
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth="1"
                  />
                </g>

                {/* Bubble (air pocket) - using viewport coordinate system */}
                <ellipse
                  cx={125 + (bubbleFinalX / 100) * 170}
                  cy="50"
                  rx="16"
                  ry="6"
                  fill={bubbleColor}
                  stroke="rgba(255, 255, 255, 0.60)"
                  strokeWidth="1.5"
                  style={{
                    filter: bubbleLocked ? 'drop-shadow(0 0 6px rgba(194, 112, 62, 0.5))' : 'none',
                    transition: bubbleLocked ? 'filter 400ms ease' : 'none',
                  }}
                />

                {/* Bubble highlight */}
                <ellipse
                  cx={125 + (bubbleFinalX / 100) * 170}
                  cy="48"
                  rx="7"
                  ry="2.5"
                  fill="rgba(255, 255, 255, 0.70)"
                  opacity={0.7 + bubbleConfidence * 0.3}
                />
              </g>
            </svg>
          </div>

          {/* Section Header */}
          <div className="text-center mb-4xl">
            <h2 className="text-display font-semibold text-foreground mb-lg">
              <div className="mb-sm">Built for field leaders:</div>
              <div className="flex justify-center">
                <div className="inline-flex items-center gap-[0.5ch]">
                  <span
                    className="text-transparent bg-clip-text bg-gradient-to-r from-terracotta to-amber text-display-lg inline-block min-w-[280px] text-right"
                    style={{
                      opacity: specialtyFading ? 0 : 1,
                      transform: specialtyFading ? 'translateY(-10px)' : 'translateY(0)',
                      transition: 'opacity 300ms ease, transform 300ms ease',
                    }}
                  >
                    {specialties[currentSpecialtyIndex]}
                  </span>
                  {specialties[currentSpecialtyIndex] !== 'Construction Superintendents' && (
                    <span className="text-display-lg">Foremen</span>
                  )}
                </div>
              </div>
            </h2>
            <p className="text-body-lg text-foreground-muted max-w-2xl mx-auto">
              Stop searching through endless PDFs. Get answers from your project documents in
              seconds.
            </p>
          </div>

          {/* Feature Cards */}
          <div
            className="overflow-hidden"
            style={{
              maxHeight: cardsVisible ? '1000px' : '0px',
              opacity: cardsVisible ? 1 : 0,
              transform: cardsVisible ? 'translateY(0)' : 'translateY(16px)',
              transition: 'max-height 700ms ease, opacity 500ms ease, transform 500ms ease',
            }}
          >
            <div className="grid md:grid-cols-3 gap-xl">
              {/* Feature 1 */}
              <div className="bento-card group hover:shadow-lg">
                <div
                  className="w-14 h-14 bg-terracotta-light flex items-center justify-center mb-xl group-hover:scale-110 group-hover:rotate-3 transition-transform"
                  style={{
                    clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
                  }}
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#C2703E"
                    strokeWidth="2"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14,2 14,8 20,8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10,9 9,9 8,9" />
                  </svg>
                </div>
                <h3 className="text-heading font-semibold text-foreground mb-sm">
                  Document Intelligence
                </h3>
                <p className="text-body text-foreground-muted">
                  Upload RFIs, submittals, specs, and drawings. Our AI indexes everything and
                  understands construction context.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bento-card group hover:shadow-lg">
                <div
                  className="w-14 h-14 bg-amber-light flex items-center justify-center mb-xl group-hover:scale-110 group-hover:rotate-3 transition-transform"
                  style={{
                    clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
                  }}
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#D4A030"
                    strokeWidth="2"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </div>
                <h3 className="text-heading font-semibold text-foreground mb-sm">
                  Voice-First Interface
                </h3>
                <p className="text-body text-foreground-muted">
                  Hands full on the job site? Just speak your question. Get spoken answers without
                  touching your phone.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bento-card group hover:shadow-lg">
                <div
                  className="w-14 h-14 bg-terracotta-light flex items-center justify-center mb-xl group-hover:scale-110 group-hover:rotate-3 transition-transform"
                  style={{
                    clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
                  }}
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#C2703E"
                    strokeWidth="2"
                  >
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </div>
                <h3 className="text-heading font-semibold text-foreground mb-sm">
                  Grounded Answers
                </h3>
                <p className="text-body text-foreground-muted">
                  Every response includes citations to your source documents. Tap to jump directly
                  to the referenced page.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS SECTION ===== */}
      <section className="bg-surface py-4xl px-lg md:px-3xl border-y border-border relative overflow-hidden">
        {/* Decorative connecting line */}
        <div className="hidden md:block absolute top-1/2 left-1/2 -translate-x-1/2 w-2/3 h-0.5 bg-gradient-to-r from-transparent via-border to-transparent" />

        <div className="max-w-6xl mx-auto">
          {/* Section Header */}
          <div className="text-center mb-4xl reveal-on-scroll reveal-fade-up">
            <h2 className="text-display font-semibold text-foreground mb-lg">How It Works</h2>
            <p className="text-body-lg text-foreground-muted">
              Three simple steps to project intelligence
            </p>
          </div>

          {/* Steps */}
          <div className="grid md:grid-cols-3 gap-3xl relative">
            {/* Step 1 */}
            <div
              className="text-center reveal-on-scroll reveal-scale"
              style={{ transitionDelay: '0ms' }}
            >
              <div
                className="w-16 h-16 rounded-full bg-terracotta text-white text-heading-lg font-bold flex items-center justify-center mx-auto mb-xl
                            hover:scale-110 hover:rotate-12 transition-transform cursor-default shadow-lg"
              >
                1
              </div>
              <h3 className="text-heading font-semibold text-foreground mb-sm">Upload Documents</h3>
              <p className="text-body text-foreground-muted">
                Drag and drop your PDFs, drawings, and specs. We support RFIs, submittals, change
                orders, and more.
              </p>
            </div>

            {/* Step 2 */}
            <div
              className="text-center reveal-on-scroll reveal-scale"
              style={{ transitionDelay: '150ms' }}
            >
              <div
                className="w-16 h-16 rounded-full bg-amber text-white text-heading-lg font-bold flex items-center justify-center mx-auto mb-xl
                            hover:scale-110 hover:rotate-12 transition-transform cursor-default shadow-lg"
              >
                2
              </div>
              <h3 className="text-heading font-semibold text-foreground mb-sm">Ask Questions</h3>
              <p className="text-body text-foreground-muted">
                Type or speak your question in natural language. Ask about specs, deadlines,
                requirements, or anything else.
              </p>
            </div>

            {/* Step 3 */}
            <div
              className="text-center reveal-on-scroll reveal-scale"
              style={{ transitionDelay: '300ms' }}
            >
              <div
                className="w-16 h-16 rounded-full bg-success text-white text-heading-lg font-bold flex items-center justify-center mx-auto mb-xl
                            hover:scale-110 hover:rotate-12 transition-transform cursor-default shadow-lg"
              >
                3
              </div>
              <h3 className="text-heading font-semibold text-foreground mb-sm">
                Get Cited Answers
              </h3>
              <p className="text-body text-foreground-muted">
                Receive accurate answers with direct citations to your documents. Verify the source
                with one click.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== USE CASES SECTION ===== */}
      <section className="landing-hero py-4xl px-lg md:px-3xl relative overflow-hidden">
        {/* Parallax background elements */}
        <div
          className="absolute opacity-5"
          style={{
            top: '10%',
            left: '5%',
            transform: `translateY(${(scrollY - 1500) * 0.2}px)`,
          }}
        >
          <svg
            width="120"
            height="120"
            viewBox="0 0 100 100"
            fill="none"
            stroke="#C2703E"
            strokeWidth="1"
          >
            <polygon points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5" />
          </svg>
        </div>
        <div
          className="absolute opacity-5"
          style={{
            bottom: '15%',
            right: '8%',
            transform: `translateY(${(scrollY - 1500) * -0.15}px) rotate(${scrollY * 0.05}deg)`,
          }}
        >
          <svg
            width="80"
            height="80"
            viewBox="0 0 100 100"
            fill="none"
            stroke="#D4A030"
            strokeWidth="1"
          >
            <circle cx="50" cy="50" r="45" />
            <circle cx="50" cy="50" r="30" />
            <circle cx="50" cy="50" r="15" />
          </svg>
        </div>

        <div className="max-w-6xl mx-auto relative z-10">
          {/* Section Header */}
          <div className="text-center mb-4xl reveal-on-scroll reveal-fade-up">
            <h2 className="text-display font-semibold text-voice-text mb-lg">
              Built for Your Industry
            </h2>
            <p className="text-body-lg text-voice-muted max-w-2xl mx-auto">
              Whether you&apos;re a general contractor, architect, or engineer, WheelPath
              understands your documents.
            </p>
          </div>

          {/* Use Case Cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-xl">
            {[
              {
                title: 'General Contractors',
                desc: 'Quickly find RFI responses, submittal requirements, and specification details across all project documents.',
                icon: (
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M2 20h20M5 20V8l7-4 7 4v12M9 20v-6h6v6" />
                  </svg>
                ),
                delay: 0,
              },
              {
                title: 'Architects',
                desc: 'Review design changes, track ASIs, and ensure specification compliance with instant document search.',
                icon: (
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polygon points="12,2 2,7 12,12 22,7" />
                    <polyline points="2,17 12,22 22,17" />
                    <polyline points="2,12 12,17 22,12" />
                  </svg>
                ),
                delay: 100,
              },
              {
                title: 'Engineers',
                desc: 'Access technical specifications, load calculations, and material requirements from your engineering documents.',
                icon: (
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                ),
                delay: 200,
              },
            ].map((item, i) => (
              <div
                key={i}
                className="p-xl rounded-md bg-voice-surface/50 border border-voice-muted/20 hover:border-terracotta/50 
                           hover:bg-voice-surface/70 hover:-translate-y-1 transition-all duration-300
                           reveal-on-scroll reveal-fade-up"
                style={{ transitionDelay: `${item.delay}ms` }}
              >
                <div className="text-terracotta mb-lg">{item.icon}</div>
                <h3 className="text-heading font-semibold text-voice-text mb-sm">{item.title}</h3>
                <p className="text-body text-voice-muted">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== SLOTTED CONNECTION → CHAT DEMO ===== */}
      <section
        ref={connectionRef}
        className="bg-background py-4xl px-lg md:px-3xl relative overflow-hidden"
      >
        <div className="max-w-4xl mx-auto">
          {/* Section Header */}
          <div className="text-center mb-3xl">
            <h2 className="text-display font-semibold text-foreground mb-lg">See It In Action</h2>
            <p className="text-body-lg text-foreground-muted">
              Try asking a question about your construction documents
            </p>
          </div>

          {/* Connection Animation Container */}
          <div className="relative h-48 mb-xl flex items-center justify-center">
            {/* Left Connection Piece (Female/Socket with hex flange) */}
            <div
              className="absolute left-0 w-1/2 h-24 flex items-center justify-end"
              style={{
                transform: `translateX(${leftX + seatOvershoot}%)`,
                transition: connectionSeated
                  ? 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)'
                  : 'none',
              }}
            >
              <svg width="220" height="96" viewBox="0 0 220 96" className="drop-shadow-md">
                <defs>
                  <linearGradient id="connGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#C2703E" />
                    <stop offset="100%" stopColor="#D4A030" />
                  </linearGradient>
                </defs>

                {/* Main body */}
                <rect x="0" y="28" width="160" height="40" rx="3" fill="url(#connGradient)" />

                {/* Hex flange at connection end */}
                <g transform="translate(170, 48)">
                  <polygon
                    points="0,-18 15,-9 15,9 0,18 -10,9 -10,-9"
                    fill="#A85D32"
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth="1"
                  />
                  {/* Socket cavity */}
                  <rect x="0" y="-10" width="35" height="20" fill="#8A4D28" />
                </g>

                {/* Hex bolt heads on body */}
                <g transform="translate(30, 38)">
                  <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="rgba(0,0,0,0.25)" />
                  <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.4)" />
                </g>
                <g transform="translate(30, 58)">
                  <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="rgba(0,0,0,0.25)" />
                  <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.4)" />
                </g>

                {/* Highlight */}
                <rect x="4" y="30" width="152" height="6" rx="2" fill="rgba(255,255,255,0.15)" />
              </svg>
            </div>

            {/* Right Connection Piece (Male/Pin with hex bolt) */}
            <div
              className="absolute right-0 w-1/2 h-24 flex items-center justify-start"
              style={{
                transform: `translateX(${rightX - seatOvershoot}%)`,
                transition: connectionSeated
                  ? 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)'
                  : 'none',
              }}
            >
              <svg width="220" height="96" viewBox="0 0 220 96" className="drop-shadow-md">
                <defs>
                  <linearGradient id="connGradient2" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#D4A030" />
                    <stop offset="100%" stopColor="#C2703E" />
                  </linearGradient>
                </defs>

                {/* Hex flange with protruding hex bolt */}
                <g transform="translate(15, 48)">
                  <polygon
                    points="0,-18 10,-9 10,9 0,18 -15,9 -15,-9"
                    fill="#A85D32"
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth="1"
                  />
                  {/* Hex bolt protrusion */}
                  <polygon points="10,-8 35,-8 35,8 10,8" fill="url(#connGradient2)" />
                  <polygon points="35,-6 40,-4 40,4 35,6" fill="#C2703E" />
                </g>

                {/* Main body */}
                <rect x="25" y="28" width="175" height="40" rx="3" fill="url(#connGradient2)" />

                {/* Hex bolt heads on body */}
                <g transform="translate(170, 38)">
                  <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="rgba(0,0,0,0.25)" />
                  <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.4)" />
                </g>
                <g transform="translate(170, 58)">
                  <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="rgba(0,0,0,0.25)" />
                  <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.4)" />
                </g>

                {/* Highlight */}
                <rect x="29" y="30" width="167" height="6" rx="2" fill="rgba(255,255,255,0.15)" />
              </svg>
            </div>

            {/* Connection line visual indicator when seated */}
            {connectionSeated && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{
                  opacity: Math.min(1, (connectionT - 0.55) / 0.15),
                }}
              >
                <div className="w-1 h-16 bg-gradient-to-b from-transparent via-terracotta to-transparent opacity-50" />
              </div>
            )}
          </div>

          {/* Chat Interface Reveal */}
          <div
            className="max-w-2xl mx-auto"
            style={{
              opacity: chatOpacity,
              transform: `scale(${chatScale}) translateY(${(1 - chatRevealPhase) * 20}px)`,
              pointerEvents: connectionSettled ? 'auto' : 'none',
            }}
          >
            <div className="bento-card p-xl">
              {/* Sample messages */}
              <div className="mb-lg space-y-sm">
                <div className="flex justify-end">
                  <div className="chat-bubble-user max-w-[80%]">
                    What's the fire rating for the steel beams?
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="chat-bubble-ai max-w-[80%]">
                    According to section 05120 of the specifications, all structural steel beams
                    require a 2-hour fire rating with spray-applied fireproofing.{' '}
                    <span className="citation-btn">Spec §05120</span>
                  </div>
                </div>
              </div>

              {/* Interactive input */}
              <div className="relative">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Try asking: When is the submittal deadline for lighting fixtures?"
                  className="input-modern w-full pr-12"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && chatInput.trim()) {
                      // Redirect to sign in when they try to use it
                      signInWithGoogle();
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (chatInput.trim()) {
                      signInWithGoogle();
                    }
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-md bg-terracotta text-white
                             flex items-center justify-center hover:bg-terracotta-dark transition-colors
                             disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!chatInput.trim()}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              {/* Disclaimer */}
              <p className="text-caption text-foreground-muted text-center mt-sm">
                Sign in to try it with your actual project documents
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA SECTION ===== */}
      <section className="bg-terracotta py-4xl px-lg md:px-3xl relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full border border-white/10" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full border border-white/10" />

        <div className="max-w-4xl mx-auto text-center relative z-10 reveal-on-scroll reveal-scale">
          <h2 className="text-display font-semibold text-white mb-lg">Start Building Smarter</h2>
          <p className="text-body-lg text-white/80 mb-3xl max-w-2xl mx-auto">
            Join construction teams who are already saving hours every week with AI-powered document
            intelligence.
          </p>

          {/* Torque Lock CTA Button */}
          <button
            onClick={() => {
              setCtaClicked(true);
              setTimeout(() => signInWithGoogle(), 400);
            }}
            onMouseEnter={() => setCtaHovered(true)}
            onMouseLeave={() => setCtaHovered(false)}
            className="group relative bg-white text-terracotta font-semibold text-body-lg px-3xl py-lg rounded-md
                       shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden"
            style={{
              transform: ctaClicked ? 'scale(0.98)' : ctaHovered ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            {/* Wrench Icon with Torque Animation */}
            <span className="inline-flex items-center gap-sm">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="transition-transform duration-500 ease-out"
                style={{
                  transform: ctaClicked
                    ? 'rotate(180deg) scale(0.9)'
                    : ctaHovered
                      ? 'rotate(45deg)'
                      : 'rotate(0deg)',
                }}
              >
                {/* Wrench icon */}
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
              <span>Get Started Free</span>

              {/* Lock indicator when clicked */}
              {ctaClicked && (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="animate-fade-in"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" opacity="0.3" />
                  <path d="M19 11h-1V9a6 6 0 0 0-12 0v2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2zm-7 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" />
                </svg>
              )}
            </span>

            {/* Hex bolt fastener visual (appears on hover) */}
            <div
              className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background:
                  'radial-gradient(circle at center, rgba(194, 112, 62, 0.1) 0%, transparent 70%)',
              }}
            >
              {/* Hex bolts in corners */}
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 300 80"
                preserveAspectRatio="none"
                className="absolute inset-0"
              >
                {/* Top-left hex bolt */}
                <g transform="translate(15, 15)" opacity="0.3">
                  <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="#C2703E" />
                  <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.4)" />
                </g>

                {/* Top-right hex bolt */}
                <g transform="translate(285, 15)" opacity="0.3">
                  <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="#C2703E" />
                  <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.4)" />
                </g>

                {/* Bottom-left hex bolt */}
                <g transform="translate(15, 65)" opacity="0.3">
                  <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="#C2703E" />
                  <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.4)" />
                </g>

                {/* Bottom-right hex bolt */}
                <g transform="translate(285, 65)" opacity="0.3">
                  <polygon points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" fill="#C2703E" />
                  <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.4)" />
                </g>
              </svg>
            </div>

            {/* Click ripple effect */}
            {ctaClicked && (
              <span
                className="absolute inset-0 rounded-md"
                style={{
                  background:
                    'radial-gradient(circle, rgba(194, 112, 62, 0.4) 0%, transparent 70%)',
                  animation: 'ping 0.4s ease-out',
                }}
              />
            )}
          </button>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="bg-voice-bg py-xl px-lg md:px-3xl border-t border-voice-surface">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-lg">
          <div className="flex items-center gap-sm">
            <div className="w-8 h-8 rounded-sm bg-gradient-to-br from-terracotta to-amber flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path
                  d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  strokeWidth="2"
                  stroke="white"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="text-body font-medium text-voice-text">WheelPath AI</span>
          </div>
          <p className="text-caption text-voice-muted">
            © {new Date().getFullYear()} WheelPath. Engineering intelligence for construction.
          </p>
        </div>
      </footer>
    </div>
  );
}
