// Light/dark theme, chosen in Settings → Display. "Automatic" follows your
// device's setting (and changes with it, e.g. dark mode at night); Light or Dark
// is remembered on this device. The same key is read by the small script in
// index.html so the right theme is applied before the first paint.

export type Theme = "light" | "dark";
export type ThemeChoice = "auto" | Theme;
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

function applyTheme() {
  document.documentElement.setAttribute("data-theme", stored() ?? deviceTheme());
}

export function themeChoice(): ThemeChoice {
  return stored() ?? "auto";
}

export function setThemeChoice(c: ThemeChoice) {
  try {
    if (c === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, c);
  } catch {
    /* still switches for this visit */
  }
  if (c === "auto") applyTheme();
  else document.documentElement.setAttribute("data-theme", c);
}

// On Automatic, keep following the device while the app is open.
media.addEventListener("change", () => {
  if (!stored()) applyTheme();
});
