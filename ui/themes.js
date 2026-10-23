export const THEMES = ['pob', 'dark', 'light', 'ocean', 'forest', 'sand'];
export const THEME_NAMES = { pob: 'themePob', dark: 'themeDark', light: 'themeLight', ocean: 'themeOcean', forest: 'themeForest', sand: 'themeSand' };
export const THEME_ALIASES = { default: 'pob', ember: 'dark', vaal: 'dark', midnight: 'dark', parchment: 'light' };
export const resolveTheme = id => THEME_ALIASES[id] ?? (THEMES.includes(id) ? id : 'pob');
export const THEME_OPTIONS = [...THEMES, ...Object.keys(THEME_ALIASES)];
