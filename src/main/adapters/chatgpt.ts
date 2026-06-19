import type { SiteAdapter } from './index';

// ChatGPT accounts created with Google sign-in should be guided to add a password in
// ChatGPT settings, then use email + password in Electron to avoid Google OAuth limits.
export const chatgptAdapter: SiteAdapter = {
  urlPattern: /https:\/\/chatgpt\.com/i,
  injectScript: () => 'false;',
  readyCheckScript: 'Boolean(document.querySelector("#prompt-textarea"));',
};
