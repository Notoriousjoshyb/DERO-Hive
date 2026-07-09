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
}