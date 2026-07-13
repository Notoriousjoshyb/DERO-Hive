import type { AppSettings } from '@shared/types';

const INTERFACE_FONT_STACKS: Record<NonNullable<AppSettings['interfaceFont']>, string> = {
  inter: "'Inter', system-ui, sans-serif",
  system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  serif: "'Tiempos Text', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace"
};

const CODE_FONT_STACKS: Record<NonNullable<AppSettings['codeFont']>, string> = {
  'jetbrains-mono': "'JetBrains Mono', ui-monospace, monospace",
  'fira-code': "'Fira Code', 'JetBrains Mono', ui-monospace, monospace",
  consolas: "'Consolas', 'Monaco', monospace",
  mono: "ui-monospace, monospace"
};

// Apply theme to <html> element. Tailwind uses darkMode: 'class' so toggling
// the 'dark' class swaps the palette. Light mode uses default tokens.
export function applyTheme(theme: AppSettings['theme'], osPrefersDark?: boolean): void {
  const root = document.documentElement;
  const isDark = theme === 'dark' || (theme === 'system' && (osPrefersDark ?? matchMedia('(prefers-color-scheme: dark)').matches));
  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';
}

export function applyFontSize(size: AppSettings['fontSize']): void {
  const root = document.documentElement;
  root.classList.remove('font-small', 'font-medium', 'font-large');
  root.classList.add(`font-${size}`);
  // The actual pixel font-size is applied by applyAppearance() using the
  // numeric interfaceFontSize percentage on top of this base.
}

export function applyAppearance(settings: AppSettings): void {
  const root = document.documentElement;
  const interfaceFont = settings.interfaceFont || 'inter';
  const codeFont = settings.codeFont || 'jetbrains-mono';
  const interfaceFontSize = settings.interfaceFontSize ?? 120;
  const terminalFontSize = settings.terminalFontSize ?? 15;
  const spacingDensity = settings.spacingDensity ?? 100;
  const inputBarOffset = settings.inputBarOffset ?? 0;

  root.style.setProperty('--font-sans', INTERFACE_FONT_STACKS[interfaceFont]);
  root.style.setProperty('--font-mono', CODE_FONT_STACKS[codeFont]);

  const basePx = settings.fontSize === 'small' ? 13 : settings.fontSize === 'large' ? 16 : 14;
  root.style.fontSize = `${basePx * (interfaceFontSize / 100)}px`;
  root.style.setProperty('--interface-font-size', `${interfaceFontSize}%`);
  root.style.setProperty('--terminal-font-size', `${terminalFontSize}px`);
  root.style.setProperty('--spacing-density', `${spacingDensity}%`);
  root.style.setProperty('--input-bar-offset', `${inputBarOffset}px`);
  document.body.style.fontFamily = INTERFACE_FONT_STACKS[interfaceFont];

  applyAccent(settings.accentColor);
  applyThemePreset(settings.themePreset);
  applyCustomCss(settings.customCss);
}

const THEME_PRESETS: Record<string, string> = {
  solarized: `:root {
    --bg: #002b36;
    --bg-elev: #073642;
    --bg-sidebar: #073642;
    --bg-input: #002b36;
    --fg: #839496;
    --fg-muted: #93a1a1;
    --fg-subtle: #586e75;
    --border: #073642;
    --border-strong: #586e75;
    --accent: #b58900;
    --accent-hover: #cb4b16;
    --accent-soft: rgba(181, 137, 0, 0.15);
    --accent-glow: rgba(181, 137, 0, 0.35);
    --user-bubble: #073642;
    --code-bg: #002b36;
  }`,
  nord: `:root {
    --bg: #2e3440;
    --bg-elev: #3b4252;
    --bg-sidebar: #2e3440;
    --bg-input: #3b4252;
    --fg: #d8dee9;
    --fg-muted: #81a1c1;
    --fg-subtle: #5e81ac;
    --border: #434c5e;
    --border-strong: #4c566a;
    --accent: #88c0d0;
    --accent-hover: #8fbcbb;
    --accent-soft: rgba(136, 192, 208, 0.15);
    --accent-glow: rgba(136, 192, 208, 0.35);
    --user-bubble: #3b4252;
    --code-bg: #2e3440;
  }`,
  catppuccin: `:root {
    --bg: #1e1e2e;
    --bg-elev: #313244;
    --bg-sidebar: #181825;
    --bg-input: #313244;
    --fg: #cdd6f4;
    --fg-muted: #a6adc8;
    --fg-subtle: #6c7086;
    --border: #45475a;
    --border-strong: #585b70;
    --accent: #f38ba8;
    --accent-hover: #fab387;
    --accent-soft: rgba(243, 139, 168, 0.15);
    --accent-glow: rgba(243, 139, 168, 0.35);
    --user-bubble: #313244;
    --code-bg: #1e1e2e;
  }`,
  gruvbox: `:root {
    --bg: #282828;
    --bg-elev: #3c3836;
    --bg-sidebar: #282828;
    --bg-input: #3c3836;
    --fg: #ebdbb2;
    --fg-muted: #d5c4a1;
    --fg-subtle: #a89984;
    --border: #504945;
    --border-strong: #665c64;
    --accent: #b8bb26;
    --accent-hover: #98971a;
    --accent-soft: rgba(184, 187, 38, 0.15);
    --accent-glow: rgba(184, 187, 38, 0.35);
    --user-bubble: #3c3836;
    --code-bg: #282828;
  }`
};

export function applyThemePreset(preset?: string): void {
  let el = document.getElementById('hive-theme-preset') as HTMLStyleElement | null;
  if (!preset || !THEME_PRESETS[preset]) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = 'hive-theme-preset';
  }
  el.textContent = THEME_PRESETS[preset];
  const customCss = document.getElementById('hive-custom-css');
  if (customCss?.parentNode) {
    customCss.parentNode.insertBefore(el, customCss);
  } else {
    document.head.appendChild(el);
  }
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Override the accent CSS variables from a user-picked hex colour. Hover is a
// slightly darkened variant; soft/glow are low-alpha washes. Empty → theme default.
export function applyAccent(accent?: string): void {
  const root = document.documentElement;
  const props = ['--accent', '--accent-hover', '--accent-soft', '--accent-glow'];
  const rgb = accent ? hexToRgb(accent) : null;
  if (!rgb) {
    props.forEach((p) => root.style.removeProperty(p));
    return;
  }
  const darken = (v: number): number => Math.max(0, Math.round(v * 0.88));
  root.style.setProperty('--accent', accent!);
  root.style.setProperty('--accent-hover', `rgb(${darken(rgb.r)}, ${darken(rgb.g)}, ${darken(rgb.b)})`);
  root.style.setProperty('--accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
  root.style.setProperty('--accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`);
}

// Inject user CSS as the last <style> in <head> so it wins the cascade.
export function applyCustomCss(css?: string): void {
  let el = document.getElementById('hive-custom-css') as HTMLStyleElement | null;
  if (!css?.trim()) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = 'hive-custom-css';
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
  // Keep it last so it overrides app styles.
  if (el !== document.head.lastElementChild) document.head.appendChild(el);
}