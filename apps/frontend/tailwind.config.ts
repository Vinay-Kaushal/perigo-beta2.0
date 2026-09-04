import type { Config } from "tailwindcss";

// Design tokens for perigo — a dense, dark work surface (closer to a
// terminal/ops dashboard than a marketing-site SaaS kit). Named to the
// role they play, not the literal color, so the palette can shift without
// touching component code.
export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0C0F14", // page background
        surface: "#141821", // cards, columns
        "surface-raised": "#1B202B", // popovers, dialogs
        border: "#242A35",
        "border-hover": "#323B4A",
        ink: "#E7E9EE", // primary text
        "ink-muted": "#8B93A3", // secondary text
        "ink-faint": "#565E6D", // placeholders, disabled
        accent: "#7C6CF6", // primary interactive (violet)
        "accent-hover": "#8F81F8",
        "accent-muted": "#312A57",
        urgent: "#F2545B",
        high: "#F5A623",
        medium: "#4FB0FF",
        low: "#6B7280",
        success: "#3DD68C",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
      },
      boxShadow: {
        panel: "0 8px 24px -8px rgba(0,0,0,0.5)",
      },
    },
  },
  plugins: [],
} satisfies Config;
