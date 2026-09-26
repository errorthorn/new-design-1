import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx,js,jsx}",
    "./components/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: "#F8FAFC",
          soft: "#FFFFFF",
          deep: "#FFFFFF",
        },
        ink: {
          DEFAULT: "#15170F",
          soft: "#3A3D30",
        },
        leaf: {
          50: "#F1FAEA",
          100: "#E3F3D6",
          300: "#A9E185",
          500: "#6BCB3F",
          600: "#4C9E2C",
          700: "#387822",
        },
        // Dashboard-only dark surface tokens (used behind a local `.dark`
        // class scoped to the dashboard shell — does not affect the
        // marketing site's cream/ink palette).
        night: {
          DEFAULT: "#0A0C08",
          soft: "#14170F",
          deep: "#050603",
          border: "#242A1C",
        },
      },
      fontFamily: {
        display: ["var(--font-lora)", "Georgia", "serif"],
        body: ["var(--font-poppins)", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      borderRadius: {
        xl: "1.25rem",
        "2xl": "1.75rem",
        pill: "999px",
      },
      keyframes: {
        "float-slow": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-14px)" },
        },
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "float-slow": "float-slow 6s ease-in-out infinite",
        "spin-slow": "spin-slow 5s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
