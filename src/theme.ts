import { useEffect, useState } from "react";

// Light/dark theme. Until you tap the toggle the app follows your device's setting;
// after that your choice is remembered on this device. The same key is read by the
// small script in index.html so the right theme is applied before the first paint.

export type Theme = "light" | "dark";
const KEY = "wine-cellar.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

const deviceTheme = (): Theme => (media.matches ? "dark" : "light");

function apply(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? deviceTheme());

  useEffect(() => {
    apply(theme);
  }, [theme]);

  // While you haven't chosen, keep following the device (e.g. automatic dark mode at night).
  useEffect(() => {
    const onChange = () => {
      if (!stored()) setTheme(deviceTheme());
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggle = () =>
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* still switches for this visit */
      }
      return next;
    });

  return [theme, toggle];
}
