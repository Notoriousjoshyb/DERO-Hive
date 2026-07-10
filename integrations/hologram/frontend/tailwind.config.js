// Removed @tailwindcss/forms - using hologram.css for all form styling
import plugin from 'tailwindcss/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/**/*.{html,js,svelte,ts}',
    './index.html',
  ],
  theme: {
    extend: {
      colors: {
        // ============================================
        // HOLOGRAM v5.5 - Void Hierarchy (backgrounds)
        // Maps to CSS variables in hologram.css
        // ============================================
        'void': {
          'pure': '#000000',
          'abyss': '#040408',
          'deep': '#08080e',
          'base': '#0c0c14',
          'mid': '#12121c',
          'up': '#181824',
          'surface': '#1e1e2a',
          'hover': '#262634',
          'active': '#2e2e3e',
          'dark': '#0c0c14',  // alias for text on bright bg
        },
        
        // ============================================
        // Cyan Spectrum (primary interactive)
        // ============================================
        'cyan': {
          DEFAULT: '#22d3ee',
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          'bright': '#67e8f9',
          'subtle': 'rgba(34, 211, 238, 0.1)',
          'med': 'rgba(34, 211, 238, 0.25)',
        },
        
        // ============================================
        // Violet Spectrum (secondary accent)
        // ============================================
        'violet': {
          DEFAULT: '#a78bfa',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
        },
        
        // ============================================
        // Emerald Spectrum (tertiary/success)
        // ============================================
        'emerald': {
          DEFAULT: '#34d399',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          'bright': '#6ee7b7',
          'subtle': 'rgba(52, 211, 153, 0.15)',
          'med': 'rgba(52, 211, 153, 0.3)',
        },
        
        // ============================================
        // Status Colors (semantic)
        // ============================================
        'ok': '#34d399',
        'warn': '#fbbf24',
        'err': {
          DEFAULT: '#f87171',
          'subtle': 'rgba(248, 113, 113, 0.15)',
          'med': 'rgba(248, 113, 113, 0.3)',
        },
        
        // ============================================
        // Border colors
        // ============================================
        'dim': 'rgba(255, 255, 255, 0.06)',
        'faint': 'rgba(255, 255, 255, 0.12)',
      },
      
      // ============================================
      // Text Colors (hierarchy)
      // ============================================
      textColor: {
        'bright': '#f8f8fc',
        'soft': '#d0d0dc',
        'muted': '#a8a8b8',
        'label': '#707088',
        'dim': '#505068',
        'faint': '#404058',
        'cyan': '#22d3ee',
        'cyan/70': 'rgba(34, 211, 238, 0.7)',
      },
      
      // ============================================
      // Placeholder colors
      // ============================================
      placeholderColor: {
        'dim': '#505068',
      },
      
      fontFamily: {
        'display': ['Orbitron', 'Rajdhani', 'system-ui', 'sans-serif'],
        'mono': ['JetBrains Mono', 'SF Mono', 'Consolas', 'monospace'],
      },
      
      // ============================================
      // Spacing (4px base grid)
      // ============================================
      spacing: {
        's-1': '4px',
        's-2': '8px',
        's-3': '12px',
        's-4': '16px',
        's-5': '20px',
        's-6': '24px',
        's-8': '32px',
        's-10': '40px',
        's-12': '48px',
        's-16': '64px',
      },
      
      // ============================================
      // Border Radius
      // ============================================
      borderRadius: {
        'xs': '3px',
        'sm': '5px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        '2xl': '24px',
      },
      
      // ============================================
      // Box Shadows (Glows)
      // ============================================
      boxShadow: {
        'glow-cyan-xs': '0 0 8px rgba(34, 211, 238, 0.2)',
        'glow-cyan-sm': '0 0 15px rgba(34, 211, 238, 0.3)',
        'glow-cyan-md': '0 0 25px rgba(34, 211, 238, 0.4)',
        'glow-cyan-lg': '0 0 40px rgba(34, 211, 238, 0.5), 0 0 80px rgba(34, 211, 238, 0.25)',
        'glow-violet-sm': '0 0 15px rgba(167, 139, 250, 0.3)',
        'glow-emerald-sm': '0 0 15px rgba(52, 211, 153, 0.3)',
      },
      
      // ============================================
      // Animations
      // ============================================
      animation: {
        'shimmer': 'shimmer 4s linear infinite',
        'logo-breath': 'logoBreath 6s ease-in-out infinite',
        'data-breath': 'dataBreath 3s ease-in-out infinite',
        'live-pulse': 'livePulse 1.5s ease-in-out infinite',
        'pulse-warn': 'pulse 2s ease infinite',
      },
      
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '100% 0' },
          '100%': { backgroundPosition: '-100% 0' },
        },
        logoBreath: {
          '0%, 100%': { filter: 'brightness(1)', opacity: '1' },
          '50%': { filter: 'brightness(1.1)', opacity: '0.95' },
        },
        dataBreath: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.9', transform: 'scale(0.995)' },
        },
        livePulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
      
      // ============================================
      // Transition Timing Functions
      // ============================================
      transitionTimingFunction: {
        'out': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      
      // ============================================
      // Transition Durations
      // ============================================
      transitionDuration: {
        'fast': '120ms',
        'med': '200ms',
        'slow': '350ms',
      },
    },
  },
  plugins: [
    // Removed forms plugin - hologram.css handles all form styling
    // ============================================
    // Custom Hologram v5.5 Utility Classes
    // ============================================
    plugin(function({ addUtilities }) {
      addUtilities({
        // Color utilities (c-* prefix for text color)
        '.c-cyan': { color: '#22d3ee' },
        '.c-cyan-bright': { color: '#67e8f9' },
        '.c-emerald': { color: '#34d399' },
        '.c-ok': { color: '#34d399' },
        '.c-warn': { color: '#fbbf24' },
        '.c-err': { color: '#f87171' },
        
        // Hover color variants
        '.hover\\:c-cyan:hover': { color: '#22d3ee' },
        '.hover\\:c-cyan-bright:hover': { color: '#67e8f9' },
        '.hover\\:c-err:hover': { color: '#f87171' },
        '.group-hover\\:c-cyan': { }, // handled by group
        
        // Background utilities for status/accents
        '.bg-cyan-subtle': { backgroundColor: 'rgba(34, 211, 238, 0.1)' },
        '.bg-cyan-med': { backgroundColor: 'rgba(34, 211, 238, 0.25)' },
        '.bg-emerald-subtle': { backgroundColor: 'rgba(52, 211, 153, 0.15)' },
        '.bg-emerald-med': { backgroundColor: 'rgba(52, 211, 153, 0.3)' },
        '.bg-emerald-bright': { backgroundColor: '#6ee7b7' },
        '.bg-err-subtle': { backgroundColor: 'rgba(248, 113, 113, 0.15)' },
        '.bg-err-med': { backgroundColor: 'rgba(248, 113, 113, 0.3)' },
        '.bg-ok': { backgroundColor: '#34d399' },
        '.bg-err': { backgroundColor: '#f87171' },
        '.bg-faint': { backgroundColor: 'rgba(255, 255, 255, 0.12)' },
        
        // Hover background variants
        '.hover\\:bg-cyan-bright:hover': { backgroundColor: '#67e8f9' },
        '.hover\\:bg-emerald-med:hover': { backgroundColor: 'rgba(52, 211, 153, 0.3)' },
        '.hover\\:bg-emerald-bright:hover': { backgroundColor: '#6ee7b7' },
        
        // Border utilities
        '.border-dim': { borderColor: 'rgba(255, 255, 255, 0.06)' },
        '.border-faint': { borderColor: 'rgba(255, 255, 255, 0.12)' },
        '.border-cyan': { borderColor: '#22d3ee' },
        '.border-emerald': { borderColor: '#34d399' },
        '.border-ok': { borderColor: '#34d399' },
        
        // Divide utilities  
        '.divide-dim > :not([hidden]) ~ :not([hidden])': { borderColor: 'rgba(255, 255, 255, 0.06)' },
        
        // Focus border variants
        '.focus\\:border-cyan:focus': { borderColor: '#22d3ee' },
        '.focus\\:ring-cyan:focus': { '--tw-ring-color': '#22d3ee' },
        
        // Hover border variants
        '.hover\\:border-cyan\\/50:hover': { borderColor: 'rgba(34, 211, 238, 0.5)' },
        '.hover\\:border-faint:hover': { borderColor: 'rgba(255, 255, 255, 0.12)' },
      })
    }),
  ],
};
