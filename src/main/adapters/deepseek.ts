import type { SiteAdapter } from './index';

export const deepseekAdapter: SiteAdapter = {
  urlPattern: /https:\/\/chat\.deepseek\.com/i,
  injectScript: (text: string) => `
    (async () => {
      const input = document.querySelector('#chat-input')
        || document.querySelector('textarea[placeholder]')
        || document.querySelector('textarea');
      if (!input || !(input instanceof HTMLTextAreaElement)) return false;

      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      await new Promise((resolve) => setTimeout(resolve, 200));

      const button = document.querySelector('button[aria-label="Send"]')
        || [...document.querySelectorAll('button')].at(-1);
      if (button && !button.disabled) {
        button.click();
        return true;
      }

      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
        composed: true
      }));
      return true;
    })();
  `,
  readyCheckScript: `
    Boolean(document.querySelector('#chat-input')
      || document.querySelector('textarea[placeholder]')
      || document.querySelector('textarea'));
  `,
};
