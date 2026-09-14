"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
const STORAGE_KEY = "perigo_theme";

/**
 * Inlined in <head> so the right theme is applied before first paint (no flash).
 * Kept tiny and dependency-free on purpose.
 */
export const themeScript = `(function(){try{var p=localStorage.getItem("${STORAGE_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

const ThemeContext = createContext<{ preference: ThemePreference; resolved: "light" | "dark"; setPreference: (p: ThemePreference) => void } | null>(null);

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  const apply = useCallback((pref: ThemePreference) => {
    const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    setResolved(dark ? "dark" : "light");
  }, []);

  useEffect(() => {
    const pref = readPreference();
    setPref(pref);
    apply(pref);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => readPreference() === "system" && apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [apply]);

  const setPreference = useCallback(
    (pref: ThemePreference) => {
      try {
        localStorage.setItem(STORAGE_KEY, pref);
      } catch {
        /* storage unavailable — still apply for this session */
      }
      setPref(pref);
      apply(pref);
    },
    [apply]
  );

  return <ThemeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
