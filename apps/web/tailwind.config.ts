import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // App surfaces — warm ivory foundation with rose/violet accents.
        base: {
          DEFAULT: "#FFF9F7",
          950: "#FFF6F4",
          900: "#FFFCFB",
          850: "#FFF8F8",
          800: "#FFF1F4"
        },
        // Card / panel surface
        surface: {
          DEFAULT: "#FFFFFF",
          50: "#FFF8FA",
          100: "#FFF3F6",
          200: "#FCEEF2"
        },
        // Brand: confident rose, supporting violet, and a fresh mint accent.
        brand: {
          DEFAULT: "#F43F75",
          primary: "#F43F75",
          secondary: "#8B5CF6",
          accent: "#10B981"
        },
        // Keep legacy "ink" tokens mapping to the new base surface so any
        // existing usage still resolves to a coherent dark surface.
        ink: {
          950: "#FFF8F8",
          900: "#FFFFFF",
          800: "#FFF0F3"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(99,102,241,0.25), 0 0 24px -6px rgba(99,102,241,0.35)",
        "glow-accent": "0 0 0 1px rgba(34,211,238,0.2), 0 0 24px -8px rgba(34,211,238,0.3)"
      },
      backgroundImage: {
        "app-gradient":
          "radial-gradient(1000px 520px at 0% -10%, rgba(244,63,117,0.13), transparent 58%), radial-gradient(900px 560px at 100% 0%, rgba(139,92,246,0.10), transparent 54%), linear-gradient(180deg, #FFFDFC 0%, #FFF7F8 100%)"
      }
    }
  },
  plugins: []
};

export default config;
