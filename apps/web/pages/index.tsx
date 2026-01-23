import { useRouter } from 'next/router';
import { useEffect, useState, useRef } from 'react';

export default function Landing() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  // Scroll-based animation state
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const heroRef = useRef<HTMLElement>(null);
  const featuresRef = useRef<HTMLElement>(null);
  const connectionRef = useRef<HTMLElement>(null);

  // Bubble level: play once when Features section is in view
  const [bubbleHasStarted, setBubbleHasStarted] = useState(false);
  const [bubbleT, setBubbleT] = useState(0); // 0..1 timeline

  // Slotted connection: play when connection section is in view
  const [connectionHasStarted, setConnectionHasStarted] = useState(false);
  const [connectionT, setConnectionT] = useState(0); // 0..1 timeline

  // Torque lock CTA state - separate for each button
  const [navHovered, setNavHovered] = useState(false);
  const [navClicked, setNavClicked] = useState(false);
  const [heroHovered, setHeroHovered] = useState(false);
  const [heroClicked, setHeroClicked] = useState(false);
  const [actionHovered, setActionHovered] = useState(false);
  const [actionClicked, setActionClicked] = useState(false);
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

  // Run connection animation timeline (3-step fade animation)
  useEffect(() => {
    if (!connectionHasStarted) return;
    if (connectionT >= 1) return;

    const durationMs = 9000; // 9 seconds total: ~3s per step + tagline linger
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

  // Don't redirect authenticated users from landing page - let them explore
  // They can navigate to /app manually via the nav button if needed

  // Calculate hexbolt rotation - 270° turn over hero section scroll
  const heroHeight = heroRef.current?.offsetHeight || viewportHeight;
  const orbRotation = Math.min((scrollY / heroHeight) * 270, 270); // Clockwise 270° turn, capped at 270°

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

  // ===== "WHEELPATH AI IN ACTION" 3-STEP FADE ANIMATION =====
  // Each step fades in, dwells, fades out (like specialty list)
  // Timeline: 0-0.26 step1 | 0.26-0.30 fade | 0.30-0.58 step2 | 0.58-0.62 fade | 0.62-0.83 step3 | 0.83-1.0 tagline linger
  
  // Step 1: CONNECT (visible 0-0.26, fade out 0.26-0.30)
  const step1Opacity = connectionT < 0.26 
    ? 1 
    : connectionT < 0.30 
      ? Math.max(0, 1 - (connectionT - 0.26) / 0.04) 
      : 0;
  const step1Progress = connectionT < 0.30 ? Math.min(1, connectionT / 0.24) : 0;
  
  // Step 2: ASK (fade in 0.30-0.34, visible 0.34-0.58, fade out 0.58-0.62)
  const step2Opacity = connectionT < 0.30 
    ? 0 
    : connectionT < 0.34 
      ? Math.min(1, (connectionT - 0.30) / 0.04) 
      : connectionT < 0.58 
        ? 1 
        : connectionT < 0.62 
          ? Math.max(0, 1 - (connectionT - 0.58) / 0.04) 
          : 0;
  const step2Progress = connectionT >= 0.30 && connectionT < 0.62 ? Math.min(1, (connectionT - 0.30) / 0.26) : 0;
  
  // Step 3: BUILD (fade in 0.62-0.66, visible 0.66-0.83, fade out 0.83-0.87)
  const step3Opacity = connectionT < 0.62 
    ? 0 
    : connectionT < 0.66 
      ? Math.min(1, (connectionT - 0.62) / 0.04) 
      : connectionT < 0.83 
        ? 1 
        : connectionT < 0.87 
          ? Math.max(0, 1 - (connectionT - 0.83) / 0.04) 
          : 0;
  const step3Progress = connectionT >= 0.62 && connectionT < 0.87 ? Math.min(1, (connectionT - 0.62) / 0.20) : 0;
  
  // Tagline: fades in at 0.90 (after step 3 fades out), lingers through 1.0
  const taglineOpacity = connectionT < 0.90 
    ? 0 
    : Math.min(1, (connectionT - 0.90) / 0.05);
  
  // Document fly-in animations (staggered within step 1)
  const doc1Progress = Math.max(0, Math.min(1, (step1Progress - 0.1) / 0.5));
  const doc2Progress = Math.max(0, Math.min(1, (step1Progress - 0.25) / 0.5));
  const doc3Progress = Math.max(0, Math.min(1, (step1Progress - 0.4) / 0.5));
  const hubGlowProgress = Math.max(0, Math.min(1, (step1Progress - 0.6) / 0.4));
  
  // Phone animations (within step 2)
  const phoneEnterProgress = Math.min(1, step2Progress / 0.5);
  const micPulseActive = step2Progress >= 0.5;
  
  // Level animations (within step 3)
  const levelEnterProgress = Math.min(1, step3Progress / 0.4);
  const bubbleLockProgress = Math.max(0, Math.min(1, (step3Progress - 0.3) / 0.5));

  // Show loading spinner briefly on mount
  if (!mounted) {
  return (
      <div className="min-h-screen bg-voice-bg flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-terracotta border-t-transparent animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen font-sans text-voice-text overflow-x-hidden landing-hero">
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

          {/* Pilot Program Button with Torque Animation */}
          <button
            onClick={() => {
              setNavClicked(true);
              setTimeout(() => router.push('/pilot'), 400);
            }}
            onMouseEnter={() => setNavHovered(true)}
            onMouseLeave={() => setNavHovered(false)}
            className="group relative bg-terracotta text-white font-semibold px-xl py-md rounded-md
                       shadow-md hover:shadow-lg transition-all duration-300 overflow-hidden"
            style={{
              transform: navClicked ? 'scale(0.98)' : navHovered ? 'scale(1.05)' : 'scale(1)',
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
                  transformOrigin: '85% 35%',
                  marginTop: '4px',
                  transform: navClicked 
                    ? 'rotate(180deg) scale(0.9)' 
                    : navHovered 
                      ? 'rotate(45deg)' 
                      : 'rotate(0deg)',
                }}
              >
                {/* Wrench icon */}
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
              <span>Pilot Program</span>
            </span>
            
            {/* Hex bolt fastener visual (appears on hover) */}
            <div 
              className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background: 'radial-gradient(circle at center, rgba(255, 255, 255, 0.1) 0%, transparent 70%)',
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
                  <polygon 
                    points="0,-3 2.5,-1.5 2.5,1.5 0,3 -2.5,1.5 -2.5,-1.5" 
                    fill="white"
                  />
                  <circle cx="0" cy="0" r="0.8" fill="rgba(0,0,0,0.3)" />
                </g>
                
                {/* Top-right hex bolt */}
                <g transform="translate(142, 8)" opacity="0.4">
                  <polygon 
                    points="0,-3 2.5,-1.5 2.5,1.5 0,3 -2.5,1.5 -2.5,-1.5" 
                    fill="white"
                  />
                  <circle cx="0" cy="0" r="0.8" fill="rgba(0,0,0,0.3)" />
                </g>
                
                {/* Bottom-left hex bolt */}
                <g transform="translate(8, 42)" opacity="0.4">
                  <polygon 
                    points="0,-3 2.5,-1.5 2.5,1.5 0,3 -2.5,1.5 -2.5,-1.5" 
                    fill="white"
                  />
                  <circle cx="0" cy="0" r="0.8" fill="rgba(0,0,0,0.3)" />
                </g>
                
                {/* Bottom-right hex bolt */}
                <g transform="translate(142, 42)" opacity="0.4">
                  <polygon 
                    points="0,-3 2.5,-1.5 2.5,1.5 0,3 -2.5,1.5 -2.5,-1.5" 
                    fill="white"
                  />
                  <circle cx="0" cy="0" r="0.8" fill="rgba(0,0,0,0.3)" />
                </g>
              </svg>
                </div>
            
            {/* Click ripple effect */}
            {navClicked && (
              <span 
                className="absolute inset-0 rounded-md"
                style={{
                  background: 'radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, transparent 70%)',
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
              transform: `scale(1) rotate(${orbRotation}deg)`,
              opacity: 1,
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
            {/* Get Started Free - Navigate to Pilot Program */}
            <button
              onClick={() => {
                setHeroClicked(true);
                setTimeout(() => router.push('/pilot'), 400);
              }}
              onMouseEnter={() => setHeroHovered(true)}
              onMouseLeave={() => setHeroHovered(false)}
              className="group relative bg-terracotta text-white font-semibold text-body-lg px-3xl py-lg rounded-md
                         shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden"
              style={{
                transform: heroClicked ? 'scale(0.98)' : heroHovered ? 'scale(1.05)' : 'scale(1)',
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
                    transformOrigin: '85% 35%',
                    marginTop: '5px',
                    transform: heroClicked
                      ? 'rotate(180deg) scale(0.9)'
                      : heroHovered
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
              {heroClicked && (
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
                <div className="inline-flex items-center gap-[0.25ch] md:gap-[0.5ch]">
                  <span
                    className="text-transparent bg-clip-text bg-gradient-to-r from-terracotta to-amber text-heading-lg md:text-display-lg inline-block min-w-[140px] md:min-w-[280px] text-right"
                    style={{
                      opacity: specialtyFading ? 0 : 1,
                      transform: specialtyFading ? 'translateY(-10px)' : 'translateY(0)',
                      transition: 'opacity 300ms ease, transform 300ms ease',
                    }}
                  >
                    {specialties[currentSpecialtyIndex]}
              </span>
                  {specialties[currentSpecialtyIndex] !== 'Construction Superintendents' && (
                    <span className="text-heading-lg md:text-display-lg">Foremen</span>
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
              Answers from Your Docs — Intelligence from Your Trade
            </h2>
            <p className="text-body-lg text-voice-muted max-w-2xl mx-auto">
              Preserve hard-earned knowledge and make it instantly accessible across your team.
            </p>
          </div>

          {/* Use Case Cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-xl">
            {[
              {
                title: 'Foremen & Superintendents',
                desc: 'Get instant answers to field questions via text or phone call. No more waiting on the office.',
                icon: (
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                ),
                delay: 0,
              },
              {
                title: 'Project Managers',
                desc: 'Track RFI status, spec clarifications, and submittal requirements across all your active projects.',
                icon: (
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                ),
                delay: 100,
              },
              {
                title: 'Specialty Trades',
                desc: 'Concrete, steel, HVAC, electrical — find the spec details your crew needs in seconds, not hours.',
                icon: (
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
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

      {/* ===== WHEELPATH AI IN ACTION: 3-STEP FADE ===== */}
      <section
        ref={connectionRef}
        className="bg-background py-4xl px-lg md:px-3xl relative overflow-hidden"
      >
        <div className="max-w-6xl mx-auto">
          {/* Section Header */}
          <div className="text-center mb-xl">
            <h2 className="text-display font-semibold text-foreground">WheelPath AI in Action</h2>
          </div>

          {/* Animation Container - stacked layers with fade */}
          <div className="relative min-h-[380px]">
            
            {/* ===== STEP 1: CONNECT ===== */}
            <div 
              className="absolute inset-0 flex flex-col items-center px-xl transition-opacity duration-300"
              style={{ 
                opacity: step1Opacity,
                pointerEvents: step1Opacity > 0 ? 'auto' : 'none',
              }}
            >
              {/* Step Label - fixed position from top */}
              <div className="pt-xl text-center">
                <h3 className="text-display md:text-display-xl font-semibold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-terracotta to-amber">Connect</h3>
              </div>
                
              {/* Desktop + Documents Animation - centered in remaining space */}
              <div className="flex-1 flex items-center justify-center">
                <div className="relative flex items-center gap-lg">
                  {/* Desktop Monitor */}
                  <div className="relative">
                    <svg width="200" height="160" viewBox="0 0 200 160" className="drop-shadow-xl">
                      {/* Monitor body */}
                      <rect x="10" y="10" width="180" height="110" rx="10" fill="#1A1612" stroke="#3D342A" strokeWidth="2" />
                      <rect x="18" y="18" width="164" height="94" rx="6" fill="#2C2419" />
                      
                      {/* Screen content - file icons */}
                      <rect x="30" y="30" width="36" height="42" rx="3" fill="#C2703E" opacity="0.9" />
                      <rect x="35" y="36" width="24" height="3" fill="white" opacity="0.6" />
                      <rect x="35" y="43" width="28" height="2" fill="white" opacity="0.4" />
                      <rect x="35" y="49" width="20" height="2" fill="white" opacity="0.4" />
                      
                      <rect x="78" y="30" width="36" height="42" rx="3" fill="#D4A030" opacity="0.9" />
                      <rect x="83" y="36" width="24" height="3" fill="white" opacity="0.6" />
                      <rect x="83" y="43" width="28" height="2" fill="white" opacity="0.4" />
                      
                      <rect x="126" y="30" width="36" height="42" rx="3" fill="#8A4D28" opacity="0.8" />
                      <rect x="131" y="36" width="24" height="3" fill="white" opacity="0.6" />
                      
                      {/* Monitor stand */}
                      <rect x="80" y="120" width="40" height="10" rx="3" fill="#3D342A" />
                      <rect x="65" y="130" width="70" height="14" rx="4" fill="#2C2419" />
                    </svg>
                    
                    {/* Flying documents */}
                    <div 
                      className="absolute -right-2 top-2"
                      style={{
                        opacity: doc1Progress,
                        transform: `translateX(${(1 - doc1Progress) * 80}px) rotate(${(1 - doc1Progress) * 20}deg) scale(${0.8 + doc1Progress * 0.2})`,
                      }}
                    >
                      <svg width="48" height="58" viewBox="0 0 48 58" className="drop-shadow-lg">
                        <rect x="0" y="0" width="48" height="58" rx="4" fill="#C2703E" />
                        <rect x="6" y="10" width="30" height="4" fill="white" opacity="0.7" />
                        <rect x="6" y="18" width="36" height="3" fill="white" opacity="0.4" />
                        <rect x="6" y="25" width="28" height="3" fill="white" opacity="0.4" />
                        <text x="6" y="48" fill="white" opacity="0.6" fontSize="10" fontFamily="monospace" fontWeight="bold">RFI</text>
                      </svg>
                    </div>
                    <div 
                      className="absolute -right-6 top-16"
                      style={{
                        opacity: doc2Progress,
                        transform: `translateX(${(1 - doc2Progress) * 100}px) rotate(${(1 - doc2Progress) * -15}deg) scale(${0.8 + doc2Progress * 0.2})`,
                      }}
                    >
                      <svg width="44" height="54" viewBox="0 0 44 54" className="drop-shadow-lg">
                        <rect x="0" y="0" width="44" height="54" rx="4" fill="#D4A030" />
                        <rect x="5" y="8" width="28" height="4" fill="white" opacity="0.7" />
                        <rect x="5" y="16" width="34" height="3" fill="white" opacity="0.4" />
                        <text x="5" y="44" fill="white" opacity="0.6" fontSize="9" fontFamily="monospace" fontWeight="bold">SPEC</text>
                      </svg>
                    </div>
                    <div 
                      className="absolute -right-4 top-28"
                      style={{
                        opacity: doc3Progress,
                        transform: `translateX(${(1 - doc3Progress) * 120}px) rotate(${(1 - doc3Progress) * 25}deg) scale(${0.8 + doc3Progress * 0.2})`,
                      }}
                    >
                      <svg width="46" height="56" viewBox="0 0 46 56" className="drop-shadow-lg">
                        <rect x="0" y="0" width="46" height="56" rx="4" fill="#8A4D28" />
                        <rect x="5" y="9" width="26" height="4" fill="white" opacity="0.7" />
                        <rect x="5" y="17" width="36" height="3" fill="white" opacity="0.4" />
                        <text x="5" y="46" fill="white" opacity="0.6" fontSize="9" fontFamily="monospace" fontWeight="bold">DWG</text>
                      </svg>
                    </div>
                  </div>

                  {/* Arrow + Hex Hub */}
                  <div className="flex items-center gap-md">
                    <svg 
                      width="50" height="24" viewBox="0 0 50 24"
                      style={{ opacity: 0.3 + hubGlowProgress * 0.7 }}
                    >
                      <path d="M0,12 L40,12 M32,6 L40,12 L32,18" stroke="#C2703E" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    
                    <div 
                      style={{
                        opacity: 0.5 + hubGlowProgress * 0.5,
                        transform: `scale(${0.9 + hubGlowProgress * 0.1})`,
                      }}
                    >
                      <svg width="90" height="90" viewBox="0 0 90 90" className="drop-shadow-xl">
                        <defs>
                          <linearGradient id="hubGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#C2703E" />
                            <stop offset="100%" stopColor="#D4A030" />
                          </linearGradient>
                          <filter id="hubGlow">
                            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                            <feMerge>
                              <feMergeNode in="coloredBlur" />
                              <feMergeNode in="SourceGraphic" />
                            </feMerge>
                          </filter>
                        </defs>
                        <polygon 
                          points="45,5 80,22 80,63 45,80 10,63 10,22" 
                          fill="url(#hubGradient)" 
                          stroke="#8A4D28" 
                          strokeWidth="2"
                          filter={hubGlowProgress > 0.8 ? "url(#hubGlow)" : undefined}
                        />
                        <polygon 
                          points="45,18 62,28 62,55 45,65 28,55 28,28" 
                          fill="none" 
                          stroke="rgba(255,255,255,0.3)" 
                          strokeWidth="1.5"
                        />
                        <circle cx="45" cy="42" r="10" fill="#8A4D28" />
                        <polygon points="45,35 52,39 52,45 45,49 38,45 38,39" fill="rgba(255,255,255,0.25)" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ===== STEP 2: ASK ===== */}
            <div 
              className="absolute inset-0 flex flex-col items-center px-xl transition-opacity duration-300"
              style={{ 
                opacity: step2Opacity,
                pointerEvents: step2Opacity > 0 ? 'auto' : 'none',
              }}
            >
              {/* Step Label - fixed position from top */}
              <div className="pt-xl text-center">
                <h3 className="text-display md:text-display-xl font-semibold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-terracotta to-amber">Ask</h3>
              </div>
              
              {/* Phone Animation - centered in remaining space */}
              <div className="flex-1 flex items-center justify-center">
                <div 
                  className="relative"
                  style={{
                    opacity: 0.3 + phoneEnterProgress * 0.7,
                    transform: `translateY(${(1 - phoneEnterProgress) * 30}px) scale(${0.9 + phoneEnterProgress * 0.1})`,
                  }}
                >
                  <svg width="160" height="300" viewBox="0 0 160 300" className="drop-shadow-2xl">
                    {/* Phone body */}
                    <rect x="10" y="10" width="140" height="280" rx="24" fill="#1A1612" stroke="#3D342A" strokeWidth="2" />
                    <rect x="18" y="28" width="124" height="244" rx="6" fill="#2C2419" />
                    
                    {/* Dynamic Island */}
                    <rect x="55" y="14" width="50" height="10" rx="5" fill="#000" />
                    
                    {/* Chat bubbles */}
                    <rect x="26" y="45" width="95" height="32" rx="12" fill="#C2703E" />
                    <rect x="34" y="54" width="65" height="4" fill="white" opacity="0.7" />
                    <rect x="34" y="62" width="45" height="3" fill="white" opacity="0.4" />
                    
                    <rect x="40" y="90" width="100" height="48" rx="12" fill="#3D342A" />
                    <rect x="48" y="100" width="80" height="4" fill="white" opacity="0.6" />
                    <rect x="48" y="108" width="70" height="3" fill="white" opacity="0.4" />
                    <rect x="48" y="116" width="55" height="3" fill="white" opacity="0.4" />
                    <rect x="48" y="124" width="40" height="3" fill="white" opacity="0.3" />
                    
                    {/* Citation badge */}
                    <rect x="48" y="145" width="50" height="16" rx="4" fill="#C2703E" opacity="0.3" />
                    <rect x="52" y="150" width="40" height="6" fill="#C2703E" opacity="0.5" />
                    
                    {/* Input bar */}
                    <rect x="26" y="240" width="108" height="24" rx="12" fill="#3D342A" stroke="#4D443A" strokeWidth="1" />
                    
                    {/* Home indicator */}
                    <rect x="55" y="275" width="50" height="5" rx="2.5" fill="#3D342A" />
                  </svg>
                  
                  {/* Hexbolt mic icon */}
                  <div 
                    className="absolute bottom-20 left-1/2 -translate-x-1/2"
                    style={{ transform: `translateX(-50%) scale(${0.9 + phoneEnterProgress * 0.1})` }}
                  >
                    <svg width="70" height="70" viewBox="0 0 70 70" className="drop-shadow-lg">
                      <defs>
                        <linearGradient id="micHexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#C2703E" />
                          <stop offset="100%" stopColor="#D4A030" />
                        </linearGradient>
                      </defs>
                      <polygon 
                        points="35,5 62,18 62,48 35,61 8,48 8,18" 
                        fill="url(#micHexGrad)" 
                        stroke="#8A4D28" 
                        strokeWidth="2"
                      />
                      <path 
                        d="M35,20 L35,38 M30,38 Q30,44 35,44 Q40,44 40,38 M35,44 L35,50" 
                        stroke="white" 
                        strokeWidth="3" 
                        strokeLinecap="round" 
                        fill="none"
                      />
                      <rect x="31" y="20" width="8" height="14" rx="4" fill="white" opacity="0.9" />
                    </svg>
                    
                    {/* Voice ripples */}
                    {micPulseActive && (
                      <>
                        <div className="absolute inset-0 rounded-full border-2 border-terracotta/50 animate-ping" style={{ animationDuration: '1.5s' }} />
                        <div className="absolute inset-0 rounded-full border-2 border-terracotta/30 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
                      </>
                    )}
                  </div>
                </div>
            </div>
          </div>

            {/* ===== STEP 3: BUILD ===== */}
            <div 
              className="absolute inset-0 flex flex-col items-center px-xl transition-opacity duration-300"
              style={{ 
                opacity: step3Opacity,
                pointerEvents: step3Opacity > 0 ? 'auto' : 'none',
              }}
            >
              {/* Step Label - fixed position from top */}
              <div className="pt-xl text-center">
                <h3 className="text-display md:text-display-xl font-semibold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-terracotta to-amber">Build</h3>
            </div>
              
              {/* Torpedo Level Animation - centered in remaining space */}
              <div className="flex-1 flex items-center justify-center">
                <div 
                  className="flex flex-col items-center gap-xl"
                  style={{
                    opacity: 0.3 + levelEnterProgress * 0.7,
                    transform: `translateY(${(1 - levelEnterProgress) * 20}px) scale(${0.95 + levelEnterProgress * 0.05})`,
                  }}
                >
                  <svg width="320" height="70" viewBox="0 0 320 70" className="drop-shadow-xl">
                    <defs>
                      <linearGradient id="levelBodyGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#C2703E" />
                        <stop offset="50%" stopColor="#A85D32" />
                        <stop offset="100%" stopColor="#8A4D28" />
                      </linearGradient>
                      <linearGradient id="liquidGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#D4A030" stopOpacity="0.4" />
                        <stop offset="50%" stopColor="#F5B041" stopOpacity="0.7" />
                        <stop offset="100%" stopColor="#D4A030" stopOpacity="0.4" />
                      </linearGradient>
                      <filter id="clarityGlow2">
                        <feGaussianBlur stdDeviation="5" result="coloredBlur" />
                        <feMerge>
                          <feMergeNode in="coloredBlur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    
                    {/* Level body with hex ends */}
                    <polygon points="18,18 35,6 285,6 302,18 302,52 285,64 35,64 18,52" 
                             fill="url(#levelBodyGrad2)" stroke="#6B4423" strokeWidth="2" />
                    
                    {/* Viewport window */}
                    <rect x="100" y="14" width="120" height="42" rx="8" fill="#1A1612" stroke="#6B4423" strokeWidth="1.5" />
                    
                    {/* Liquid fill */}
                    <rect x="104" y="18" width="112" height="34" rx="5" fill="url(#liquidGrad2)" />
                    
                    {/* Center marks */}
                    <line x1="160" y1="14" x2="160" y2="24" stroke="#C2703E" strokeWidth="2.5" />
                    <line x1="160" y1="46" x2="160" y2="56" stroke="#C2703E" strokeWidth="2.5" />
                    
                    {/* Bubble - drifts to center */}
                    <ellipse 
                      cx={160 + (1 - bubbleLockProgress) * 35} 
                      cy="35" 
                      rx="16" 
                      ry="12" 
                      fill={bubbleLockProgress > 0.8 ? "#C2703E" : "#D4A030"}
                      filter={bubbleLockProgress > 0.8 ? "url(#clarityGlow2)" : undefined}
                      style={{ transition: 'fill 0.3s ease' }}
                    />
                    <ellipse 
                      cx={160 + (1 - bubbleLockProgress) * 35} 
                      cy="32" 
                      rx="9" 
                      ry="5" 
                      fill="rgba(255,255,255,0.35)"
                    />
                    
                    {/* Measurement marks */}
                    <line x1="55" y1="28" x2="55" y2="42" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
                    <line x1="80" y1="24" x2="80" y2="46" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
                    <line x1="240" y1="24" x2="240" y2="46" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
                    <line x1="265" y1="28" x2="265" y2="42" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
                  </svg>
                </div>
              </div>
            </div>

            {/* ===== TAGLINE - appears after all animations ===== */}
            <div 
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{ 
                opacity: taglineOpacity,
              }}
            >
              <div 
                className="text-center"
                style={{
                  transform: `translateY(${(1 - taglineOpacity) * 20}px)`,
                  transition: 'transform 400ms ease-out',
                }}
              >
                <p className="text-display md:text-display-xl font-semibold tracking-tight text-foreground">
                  Get Clarity.
                </p>
                <p className="text-display md:text-display-xl font-semibold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-terracotta to-amber">
                  Go Build.
                </p>
              </div>
            </div>
              
          </div>

          {/* CTA Buttons - always visible */}
          <div className="mt-3xl flex flex-col sm:flex-row items-center justify-center gap-lg">
            {/* Pilot Program Button with Wrench Animation */}
              <button
              onClick={() => {
                setActionClicked(true);
                setTimeout(() => router.push('/pilot'), 400);
              }}
              onMouseEnter={() => setActionHovered(true)}
              onMouseLeave={() => setActionHovered(false)}
              className="group relative bg-terracotta text-white font-semibold text-body-lg px-3xl py-lg rounded-md
                         shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden"
              style={{
                transform: actionClicked ? 'scale(0.98)' : actionHovered ? 'scale(1.05)' : 'scale(1)',
              }}
            >
              <span className="inline-flex items-center gap-sm">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-transform duration-500 ease-out"
                  style={{
                    transformOrigin: '85% 35%',
                    marginTop: '4px',
                    transform: actionClicked ? 'rotate(180deg) scale(0.9)' : actionHovered ? 'rotate(45deg)' : 'rotate(0deg)',
                  }}
                >
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                <span>Pilot Program</span>
              </span>
              
              {/* Hex bolt fastener visual (appears on hover) */}
              <div 
                className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background: 'radial-gradient(circle at center, rgba(255, 255, 255, 0.1) 0%, transparent 70%)',
                }}
              >
                {/* Hex bolts in corners */}
                <svg 
                  width="100%" 
                  height="100%" 
                  viewBox="0 0 200 60" 
                  preserveAspectRatio="none"
                  className="absolute inset-0"
                >
                  {/* Top-left hex bolt */}
                  <g transform="translate(10, 10)" opacity="0.4">
                    <polygon 
                      points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" 
                      fill="white"
                    />
                    <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.3)" />
                  </g>
                  
                  {/* Top-right hex bolt */}
                  <g transform="translate(190, 10)" opacity="0.4">
                    <polygon 
                      points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" 
                      fill="white"
                    />
                    <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.3)" />
                  </g>
                  
                  {/* Bottom-left hex bolt */}
                  <g transform="translate(10, 50)" opacity="0.4">
                    <polygon 
                      points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" 
                      fill="white"
                    />
                    <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.3)" />
                  </g>
                  
                  {/* Bottom-right hex bolt */}
                  <g transform="translate(190, 50)" opacity="0.4">
                    <polygon 
                      points="0,-4 3.5,-2 3.5,2 0,4 -3.5,2 -3.5,-2" 
                      fill="white"
                    />
                    <circle cx="0" cy="0" r="1" fill="rgba(0,0,0,0.3)" />
                  </g>
                </svg>
            </div>
              
              {/* Click ripple effect */}
              {actionClicked && (
                <span
                  className="absolute inset-0 rounded-md pointer-events-none"
                  style={{
                    background: 'radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, transparent 70%)',
                    animation: 'ping 0.4s ease-out',
                  }}
                />
              )}
            </button>

            {/* Watch Demo Button */}
              <button
              className="group flex items-center justify-center gap-sm px-3xl py-lg rounded-md border-2 border-foreground-muted/30 text-foreground
                         hover:border-terracotta hover:text-terracotta transition-all duration-300"
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
      </section>

      {/* ===== FINAL CTA SECTION ===== */}
      <section className="bg-terracotta py-4xl px-lg md:px-3xl relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full border border-white/10" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full border border-white/10" />

        <div className="max-w-4xl mx-auto text-center relative z-10 reveal-on-scroll reveal-scale">
          <h2 className="text-display font-semibold text-white mb-lg">Your Best Project Is One Call Away</h2>
          <p className="text-body-lg text-white/80 mb-3xl max-w-2xl mx-auto">
            Join specialty contractors who are already saving hours every week with AI-powered document
            intelligence.
          </p>

          {/* Torque Lock CTA Button */}
              <button
            onClick={() => {
              setCtaClicked(true);
              setTimeout(() => router.push('/pilot'), 400);
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
                  transformOrigin: '85% 35%',
                  marginTop: '5px',
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
