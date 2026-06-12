/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class", // toggled by ThemeProvider adding/removing `dark` on <html>
  theme: {
    extend: {
      fontFamily: {
        sans: ["Nunito", "system-ui", "sans-serif"],
        display: ['"Baloo 2"', "cursive"],
      },
    },
  },
  // Tints are dynamic; keep these safe from purging.
  safelist: [
    { pattern: /(bg|text|ring|border|from|to)-(indigo|violet|emerald|amber|rose|sky)-(50|100|200|400|500)/ },
  ],
  plugins: [],
};
