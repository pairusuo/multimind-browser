import type { SiteAdapter } from './index';

export const deepseekAdapter: SiteAdapter = {
  urlPattern: /https:\/\/chat\.deepseek\.com/i,
  injectScript: () => 'false;',
  readyCheckScript: 'Boolean(document.querySelector("textarea"));',
};
