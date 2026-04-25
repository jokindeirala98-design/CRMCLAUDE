import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ─── Editorial + Instrumento — Voltis v2 ───────────────────────

        // Raw neutrals — warm crema palette (themeSalvia)
        bg: '#F4EEE2',       // crema canvas — fondo global
        'bg-2': '#EDE8DC',   // crema medio — sidebar, secciones
        ink: '#2D3A33',      // verde oscuro cálido — texto principal
        'ink-2': '#3D4E44',
        'ink-3': '#5A6B5F',
        'ink-4': '#8A9A8E',
        line: '#E5DCC9',     // borde crema-durazno
        'line-2': '#D9D0BA',
        card: '#FBF7EE',     // papel crema — fondo de cards

        // Brand
        brand: '#1F3A2E',
        'brand-2': '#2F5C47',

        // Volt accent
        volt: '#C7F24A',
        'volt-ink': '#1D2C0E',

        // ─── themeSalvia — warm editorial palette (informe + UI accents) ──
        salvia:        '#6B8068',   // sage green — primary report accent
        'salvia-soft': '#E0E8DC',   // sage tint — chip/badge backgrounds
        'salvia-dark': '#5A6E58',   // deeper sage — gradients
        durazno:       '#E8B89A',   // peach — dividers, highlights
        'durazno-soft':'#F5DCC9',   // peach tint — badge bg
        crema:         '#F4EEE2',   // warm canvas background
        'crema-paper': '#FBF7EE',   // warm white — card/paper surface
        lavanda:       '#E8E0F0',   // lavender tint — 6.1TD badge bg
        'lavanda-ink': '#6B5A82',   // lavender ink

        // Semantic states (oklch-derived hex approximations)
        ok: 'oklch(0.72 0.14 150)',
        'ok-container': 'oklch(0.96 0.04 150)',
        warn: 'oklch(0.72 0.14 75)',
        'warn-container': 'oklch(0.96 0.04 75)',
        err: 'oklch(0.65 0.17 25)',
        'err-container': 'oklch(0.96 0.05 25)',
        info: 'oklch(0.65 0.12 240)',
        'info-container': 'oklch(0.96 0.04 240)',
        neutral: 'oklch(0.55 0.01 100)',
        'neutral-container': 'oklch(0.96 0.01 100)',

        // ─── Legacy "Kinetic Precision" — kept for backward compat ──────
        primary: {
          DEFAULT: '#1F3A2E',
          container: '#2F5C47',
          light: '#3D7A5F',
        },
        secondary: {
          DEFAULT: '#1F3A2E',
          container: '#2F5C47',
          light: '#3D7A5F',
          fixed_dim: '#C7F24A',
        },
        surface: {
          DEFAULT: '#FAFAF7',
          dim: '#F3F2EC',
          container: {
            lowest: '#FFFFFF',
            low: '#F7F6F0',
            DEFAULT: '#F3F2EC',
            high: '#ECEAE0',
            highest: '#E6E4DB',
          },
        },
        on: {
          surface: '#141413',
          'surface-variant': '#6C6C66',
          primary: '#FFFFFF',
          secondary: '#FFFFFF',
        },
        outline: {
          DEFAULT: '#A6A59D',
          variant: '#E6E4DB',
        },
        error: {
          DEFAULT: 'oklch(0.65 0.17 25)',
          container: 'oklch(0.96 0.05 25)',
        },
        warning: {
          DEFAULT: 'oklch(0.72 0.14 75)',
          container: 'oklch(0.96 0.04 75)',
        },
        success: {
          DEFAULT: 'oklch(0.72 0.14 150)',
          container: 'oklch(0.96 0.04 150)',
        },
      },

      fontFamily: {
        // New system
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        // Legacy names — kept for backward compat
        display: ['Geist', 'ui-sans-serif', 'sans-serif'],
        body: ['Geist', 'ui-sans-serif', 'sans-serif'],
      },

      borderRadius: {
        sm: '0.25rem',
        DEFAULT: '0.375rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      },

      boxShadow: {
        // New — minimal, used only for modals/dropdowns
        'ambient': '0 4px 24px 0 rgba(20,20,19,0.08)',
        'ambient-sm': '0 1px 4px 0 rgba(20,20,19,0.06)',
        'ambient-lg': '0 8px 40px 0 rgba(20,20,19,0.12)',
        // Legacy names kept
        'glass': '0 4px 24px 0 rgba(20,20,19,0.08)',
      },

      fontSize: {
        // Label mono utility
        'label-mono': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.08em', fontWeight: '500' }],
      },
    },
  },
  plugins: [],
}

export default config
