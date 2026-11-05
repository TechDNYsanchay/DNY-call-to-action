"use client";

import { Monitor, MoonStars, SunDim } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";
import { IconButton } from "@/components/ui/button";

// System -> light -> dark -> system. Writes localStorage "cta-theme" and data-theme on <html>,
// exactly what the inline script in src/app/layout.tsx reads before first paint. The stored choice
// is read through useSyncExternalStore so the server renders "system" and the client corrects it
// without a setState-in-effect.

type Theme = "system" | "light" | "dark";
const KEY = "cta-theme";

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  for (const cb of listeners) cb();
}

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABELS: Record<Theme, string> = { system: "Theme: follows the system", light: "Theme: light", dark: "Theme: dark" };

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  const Icon = theme === "light" ? SunDim : theme === "dark" ? MoonStars : Monitor;
  return (
    <IconButton label={`${LABELS[theme]}. Switch`} className={className} onClick={() => applyTheme(NEXT[theme])}>
      <Icon size={18} aria-hidden="true" />
    </IconButton>
  );
}
