/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'], mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'] },
      colors: { ink: '#1c2430', paper: '#f6f5f1', line: '#dcd9d0', accent: { DEFAULT: '#0f5c63', soft: '#e3f0f0' } },
    },
  },
  plugins: [],
};
