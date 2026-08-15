/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'var(--bg)',
          elev: 'var(--bg-elev)',
          sidebar: 'var(--bg-sidebar)',
          input: 'var(--bg-input)',
          code: 'var(--code-bg)',
          bubble: 'var(--user-bubble)'
        },
        fg: {
          DEFAULT: 'var(--fg)',
          muted: 'var(--fg-muted)',
          subtle: 'var(--fg-subtle)'
        },
        // Channel-triplet form so Tailwind's opacity modifier composes:
        // `bg-accent/10` with a bare var() colour is silently DROPPED in v3.
        // accent-soft / accent-glow stay bare — they are already alpha washes,
        // so a further /NN on them has no coherent meaning.
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover-rgb) / <alpha-value>)',
          soft: 'var(--accent-soft)',
          glow: 'var(--accent-glow)'
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)'
        },
        // Themed, not hardcoded — each preset redefines these so status chips
        // match the palette instead of the default one.
        success: 'rgb(var(--success) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)'
      },
      boxShadow: {
        'elev-sm': 'var(--shadow-sm)',
        'elev-md': 'var(--shadow-md)',
        'elev-lg': 'var(--shadow-lg)',
        composer: 'var(--shadow-composer)'
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        serif: ['var(--font-serif)', 'Georgia', 'serif']
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'pulse-dot': 'pulseDot 1.4s infinite ease-in-out both',
        'spin-slow': 'spin 1.2s linear infinite'
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideUp: { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        pulseDot: { '0%, 80%, 100%': { opacity: 0.3 }, '40%': { opacity: 1 } }
      }
    }
  },
  plugins: []
};
