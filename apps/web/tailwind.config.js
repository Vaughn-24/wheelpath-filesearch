/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Core palette - Engineered Warmth
        background: '#FAF8F5',
        surface: '#FFFFFF',
        foreground: {
          DEFAULT: '#2C2419',
          muted: '#6B5D4D',
          subtle: '#A69882',
        },

        // Accent colors
        terracotta: {
          DEFAULT: '#C2703E',
          light: '#F5E6DC',
          dark: '#A85D32',
        },
        amber: {
          DEFAULT: '#D4A030',
          light: '#FDF6E3',
        },

        // Semantic colors
        error: '#B54A32',
        warning: '#D4A030',
        success: '#5A7D4C',

        // Voice mode (dark/immersive)
        voice: {
          bg: '#1A1612',
          surface: '#2C2419',
          text: '#FAF8F5',
          muted: '#A69882',
        },

        // Border colors
        border: {
          DEFAULT: '#D4CFC6',
          hover: '#C2703E',
        },
      },
      fontFamily: {
        // Sans-serif only - using Inter from next/font
        sans: [
          'var(--font-inter)',
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['SF Mono', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
      },
      fontSize: {
        'display-xl': ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-lg': ['42px', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '600' }],
        display: ['36px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        'heading-lg': ['24px', { lineHeight: '1.3', letterSpacing: '-0.02em', fontWeight: '600' }],
        heading: ['20px', { lineHeight: '1.4', letterSpacing: '-0.02em', fontWeight: '500' }],
        'body-lg': ['18px', { lineHeight: '1.6', fontWeight: '400' }],
        body: ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-sm': ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '1.4', letterSpacing: '0.02em', fontWeight: '500' }],
        micro: ['10px', { lineHeight: '1.3', letterSpacing: '0.02em', fontWeight: '600' }],
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        '2xl': '32px',
        '3xl': '48px',
        '4xl': '64px',
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        full: '9999px',
      },
      boxShadow: {
        sm: '0 2px 8px rgba(44, 36, 25, 0.06)',
        md: '0 4px 16px rgba(44, 36, 25, 0.08)',
        lg: '0 8px 32px rgba(44, 36, 25, 0.12)',
        xl: '0 16px 48px rgba(44, 36, 25, 0.16)',
      },
      transitionDuration: {
        fast: '150ms',
        base: '200ms',
        slow: '300ms',
      },
    },
  },
  plugins: [],
};
