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
        // Loaded via next/font in app/layout.tsx; system stack as fallback.
        sans: [
          'var(--font-sans)',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
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
        // Extended semantics (revamp)
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
        'brand-deep': 'hsl(var(--brand-deep))',
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          deep: 'hsl(var(--sidebar-background-deep))',
          foreground: 'hsl(var(--sidebar-foreground))',
          muted: 'hsl(var(--sidebar-muted))',
          active: 'hsl(var(--sidebar-active))',
          border: 'hsl(var(--sidebar-border))',
        },
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
          '6': 'hsl(var(--chart-6))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        // Soft brand-tinted elevation ramp for cards/menus/FABs.
        'elevation-1': '0 1px 2px 0 hsl(var(--brand-deep) / 0.06)',
        'elevation-2':
          '0 2px 8px -2px hsl(var(--brand-deep) / 0.1), 0 1px 2px 0 hsl(var(--brand-deep) / 0.06)',
        'elevation-3':
          '0 10px 30px -12px hsl(var(--brand-deep) / 0.25), 0 2px 8px -4px hsl(var(--brand-deep) / 0.1)',
        'elevation-4':
          '0 24px 48px -16px hsl(var(--brand-deep) / 0.35), 0 8px 16px -8px hsl(var(--brand-deep) / 0.15)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pop: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '60%': { transform: 'scale(1.02)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        // Menus/popovers: scale from origin with a whisper of movement.
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96) translateY(-2px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        // Mobile bottom sheet / drawer entrances.
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
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
        // Skeleton loading sweep (used with a translucent gradient overlay).
        'shimmer-sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        // Horizontal error nudge.
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-5px)' },
          '40%': { transform: 'translateX(5px)' },
          '60%': { transform: 'translateX(-3px)' },
          '80%': { transform: 'translateX(2px)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
        'fade-in-up': 'fade-in-up 0.3s ease-out both',
        pop: 'pop 0.2s ease-out both',
        'scale-in': 'scale-in 0.16s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-up': 'slide-up 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-left': 'slide-in-left 0.25s ease-out both',
        blob: 'blob 18s ease-in-out infinite',
        'card-in': 'card-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 5s linear infinite',
        'shimmer-sweep': 'shimmer-sweep 1.6s ease-in-out infinite',
        shake: 'shake 0.4s ease-in-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
