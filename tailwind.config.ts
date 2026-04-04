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
        // Kinetic Precision Framework - Voltis Energia
        primary: {
          DEFAULT: '#001e40',
          container: '#003366',
          light: '#0a4a8a',
        },
        secondary: {
          DEFAULT: '#006d43',
          container: '#00a368',
          light: '#00D084',
          fixed_dim: '#31e193',
        },
        surface: {
          DEFAULT: '#f8f9fb',
          dim: '#e8eaed',
          container: {
            lowest: '#ffffff',
            low: '#f2f4f6',
            DEFAULT: '#eceef0',
            high: '#e2e4e7',
            highest: '#d8dade',
          },
        },
        on: {
          surface: '#191c1e',
          'surface-variant': '#42474e',
          primary: '#ffffff',
          secondary: '#ffffff',
        },
        outline: {
          DEFAULT: '#72787e',
          variant: '#c2c7ce',
        },
        error: {
          DEFAULT: '#ba1a1a',
          container: '#ffdad6',
        },
        warning: {
          DEFAULT: '#e8a317',
          container: '#fff3d6',
        },
        success: {
          DEFAULT: '#006d43',
          container: '#d4f5e4',
        },
      },
      fontFamily: {
        display: ['Manrope', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        'xl': '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        'ambient': '0 20px 40px rgba(0, 30, 64, 0.06)',
        'ambient-sm': '0 8px 20px rgba(0, 30, 64, 0.04)',
        'ambient-lg': '0 30px 60px rgba(0, 30, 64, 0.08)',
      },
    },
  },
  plugins: [],
}

export default config
