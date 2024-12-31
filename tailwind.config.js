/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'space-black': '#0a0a0a',
        'space-blue': '#1a1b4b',
        'space-gray': '#2d2d2d',
      },
      fontFamily: {
        'mono': ['Space Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}; 