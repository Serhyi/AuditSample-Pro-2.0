/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EDFCF4',
          100: '#D4F7E5',
          200: '#A8EDCB',
          300: '#6DD9A3',
          400: '#2EBD7A',
          500: '#00A35C',
          600: '#00854B',
          700: '#006B3C',
          800: '#00542F',
          900: '#003D23',
        },
        neutral: {
          950: '#0C1118',
          900: '#141B26',
        },
        gold: {
          DEFAULT: '#C49B2A',
          light: '#F5E6B8',
        }
      },
      fontFamily: {
        display: ['DM Serif Display', 'Georgia', 'serif'],
        sans: ['Plus Jakarta Sans', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out forwards',
      }
    },
  },
  plugins: [],
}
