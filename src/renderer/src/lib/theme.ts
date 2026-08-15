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
  // Light and dark carry different accents — re-mirror after the swap.
  syncColorChannels();
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
  // Last: the preset and custom CSS can both redefine --accent.
  syncColorChannels();
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
    --accent-rgb: 181 137 0;
    --accent-hover-rgb: 203 75 22;
    --success: 133 153 0;
    --warn: 181 137 0;
    --danger: 220 50 47;
    --info: 38 139 210;
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
    --accent-rgb: 136 192 208;
    --accent-hover-rgb: 143 188 187;
    --success: 163 190 140;
    --warn: 235 203 139;
    --danger: 191 97 106;
    --info: 129 161 193;
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
    --accent-rgb: 243 139 168;
    --accent-hover-rgb: 250 179 135;
    --success: 166 227 161;
    --warn: 249 226 175;
    --danger: 243 139 168;
    --info: 137 180 250;
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
    --accent-rgb: 184 187 38;
    --accent-hover-rgb: 152 151 26;
    --success: 184 187 38;
    --warn: 250 189 47;
    --danger: 251 73 52;
    --info: 131 165 152;
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

/**
 * Parse any CSS colour we put in a theme token into an "r g b" channel triplet.
 * Accepts #rgb, #rrggbb, rgb()/rgba() — the three forms the presets, the
 * stylesheet defaults and applyAccent() actually emit. Alpha is dropped: the
 * channels exist so Tailwind can compose its own alpha on top.
 */
export function cssColorToChannels(value: string): string | null {
  const v = value.trim();
  if (!v) return null;

  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return short.slice(1, 4).map((c) => parseInt(c + c, 16)).join(' ');

  const long = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (long) return long.slice(1, 4).map((c) => parseInt(c, 16)).join(' ');

  const fn = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (fn) return fn.slice(1, 4).map((n) => Math.max(0, Math.min(255, Math.round(Number(n))))).join(' ');

  // Already a bare triplet (a preset or custom CSS set the -rgb var directly).
  const triplet = v.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (triplet) return `${triplet[1]} ${triplet[2]} ${triplet[3]}`;

  return null;
}

// Tailwind can only apply an opacity modifier (bg-accent/10) to a colour
// written as `rgb(var(--x) / <alpha-value>)`; given a bare var() it drops the
// utility entirely. The palette is authored as hex/rgba for direct use in CSS,
// so mirror the accent pair into channel triplets after every change — this is
// what makes accent opacity work under theme presets and user-picked accents,
// which set --accent from CSS rather than from the static stylesheet.
const CHANNEL_MIRRORS: ReadonlyArray<readonly [string, string]> = [
  ['--accent', '--accent-rgb'],
  ['--accent-hover', '--accent-hover-rgb']
];

export function syncColorChannels(): void {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  for (const [source, target] of CHANNEL_MIRRORS) {
    const channels = cssColorToChannels(computed.getPropertyValue(source));
    // Leave the stylesheet's static fallback in place if we can't parse it,
    // rather than blanking the colour out.
    if (channels) root.style.setProperty(target, channels);
  }
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