import type { Config } from "tailwindcss";

// Colors are CSS variables holding RGB channels (see globals.css), so every
// token supports opacity modifiers (bg-accent/10) and swaps with the theme.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        surface: token("surface"),
        "surface-muted": token("surface-muted"),
        "surface-hover": token("surface-hover"),
        border: token("border"),
        "border-strong": token("border-strong"),
        ink: token("ink"),
        "ink-muted": token("ink-muted"),
        "ink-faint": token("ink-faint"),
        accent: token("accent"),
        "accent-hover": token("accent-hover"),
        "accent-soft": token("accent-soft"),
        "accent-ink": token("accent-ink"),
        success: token("success"),
        warning: token("warning"),
        danger: token("danger"),
        info: token("info"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["11px", "16px"],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
        xl: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgb(16 24 40 / 0.04)",
        pop: "0 12px 32px -8px rgb(16 24 40 / 0.18), 0 2px 6px rgb(16 24 40 / 0.06)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.97) translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        pulse: { "50%": { opacity: ".5" } },
      },
      animation: {
        "fade-in": "fade-in 120ms ease-out",
        "scale-in": "scale-in 140ms ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
