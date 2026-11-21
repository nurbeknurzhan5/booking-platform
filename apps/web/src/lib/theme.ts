import type { CSSProperties } from 'react';
import type { PublicPageData } from './types';

/**
 * Тема публичной страницы и записи (задачи 23–24): макет шаблона + стиль (шрифт, первый экран, карточки, скругления)
 * + цветовая схема. Стиль задаётся в конфигурации шаблона (суперадмин), недостающее берётся из умолчаний макета.
 */
export type ThemeFont = 'sans' | 'serif' | 'display' | 'mono';
export type ThemeHero = 'cover' | 'split' | 'centered' | 'minimal';
export type ThemeCards = 'shadow' | 'outline' | 'flat' | 'glass';
export type ThemeRadius = 'none' | 'md' | 'xl' | '2xl';
export interface ThemeStyle {
  font: ThemeFont;
  hero: ThemeHero;
  cards: ThemeCards;
  radius: ThemeRadius;
}

const DEFAULTS: Record<string, ThemeStyle> = {
  classic: { font: 'serif', hero: 'centered', cards: 'outline', radius: 'md' },
  modern: { font: 'sans', hero: 'split', cards: 'shadow', radius: '2xl' },
  minimal: { font: 'sans', hero: 'minimal', cards: 'flat', radius: 'none' },
  bold: { font: 'display', hero: 'cover', cards: 'outline', radius: 'xl' },
  neon: { font: 'mono', hero: 'cover', cards: 'glass', radius: 'xl' },
  warm: { font: 'serif', hero: 'cover', cards: 'shadow', radius: '2xl' },
  luxe: { font: 'serif', hero: 'cover', cards: 'outline', radius: 'none' },
  fresh: { font: 'display', hero: 'split', cards: 'shadow', radius: 'xl' },
};

const RADIUS: Record<ThemeRadius, string> = { none: '0px', md: '10px', xl: '16px', '2xl': '26px' };

export function resolveTheme(template: PublicPageData['template']): ThemeStyle {
  const base = DEFAULTS[template.layout] ?? DEFAULTS.classic!;
  return { ...base, ...(template.style ?? {}) };
}

/** CSS-переменные цветов и скругления + классы шрифта и карточек для корневого элемента. */
export function themeRoot(template: PublicPageData['template']): { style: CSSProperties; className: string; theme: ThemeStyle } {
  const theme = resolveTheme(template);
  const c = template.colors;
  const style = {
    '--tpl-primary': c.primary,
    '--tpl-accent': c.accent,
    '--tpl-bg': c.background,
    '--tpl-surface': c.surface,
    '--tpl-text': c.text,
    '--tpl-radius': RADIUS[theme.radius],
  } as CSSProperties;
  return { style, className: `tpl tpl-font-${theme.font} tpl-cards-${theme.cards} tpl-layout-${template.layout}`, theme };
}
