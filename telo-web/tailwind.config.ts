import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    // Tighter gutters on phones (16px) widening to 2rem on larger screens —
    // a single high-leverage win for every page on small displays.
    container: {
      center: true,
      padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem' },
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        // Wired to next/font CSS variables set on <html> in app/layout.tsx.
        sans: [
          'var(--font-body)',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        display: [
          'var(--font-display)',
          'var(--font-body)',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'var(--font-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },
      boxShadow: {
        // Tinted elevation scale — replaces flat grey shadows everywhere.
        card: '0 1px 2px rgba(23, 23, 46, 0.04), 0 8px 24px -12px rgba(37, 36, 90, 0.12)',
        'card-hover':
          '0 2px 4px rgba(23, 23, 46, 0.05), 0 16px 40px -12px rgba(37, 36, 90, 0.2)',
        glow: '0 0 0 1px hsl(var(--primary) / 0.12), 0 4px 20px -4px hsl(var(--primary) / 0.45)',
        'glow-lg':
          '0 0 0 1px hsl(var(--primary) / 0.15), 0 8px 40px -8px hsl(var(--primary) / 0.55)',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pop: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '60%': { transform: 'scale(1.02)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        // Slow, organic drift for the ambient background blobs.
        blob: {
          '0%, 100%': { transform: 'translate(0px, 0px) scale(1)' },
          '33%': { transform: 'translate(40px, -50px) scale(1.1)' },
          '66%': { transform: 'translate(-30px, 30px) scale(0.92)' },
        },
        // Entrance: rise + de-blur, for hero-level moments (login card).
        'card-in': {
          '0%': {
            opacity: '0',
            transform: 'translateY(24px) scale(0.97)',
            filter: 'blur(10px)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0) scale(1)',
            filter: 'blur(0)',
          },
        },
        // Gradient sweep across bg-clip-text brand marks (needs
        // bg-[length:200%_auto] on the element).
        shimmer: {
          '0%': { backgroundPosition: '200% center' },
          '100%': { backgroundPosition: '-200% center' },
        },
        // Horizontal error nudge.
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-5px)' },
          '40%': { transform: 'translateX(5px)' },
          '60%': { transform: 'translateX(-3px)' },
          '80%': { transform: 'translateX(2px)' },
        },
        // Slow hue-drift for the aurora backdrop layers.
        aurora: {
          '0%, 100%': {
            transform: 'translate(0, 0) rotate(0deg) scale(1)',
          },
          '33%': {
            transform: 'translate(4%, -6%) rotate(8deg) scale(1.08)',
          },
          '66%': {
            transform: 'translate(-5%, 4%) rotate(-6deg) scale(0.95)',
          },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.3s ease-out both',
        pop: 'pop 0.2s ease-out both',
        blob: 'blob 18s ease-in-out infinite',
        'card-in': 'card-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 5s linear infinite',
        shake: 'shake 0.4s ease-in-out',
        aurora: 'aurora 24s ease-in-out infinite',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
