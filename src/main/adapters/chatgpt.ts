import type { SiteAdapter } from './index';

// ChatGPT accounts created with Google sign-in should be guided to add a password in
// ChatGPT settings, then use email + password in Electron to avoid Google OAuth limits.
export const chatgptAdapter: SiteAdapter = {
  urlPattern: /https:\/\/chatgpt\.com/i,
  injectScript: (text: string) => `
    (async () => {
      let input = document.querySelector('#prompt-textarea[contenteditable="true"]');
      if (!input) {
        input = document.querySelector('textarea#prompt-textarea');
      }
      if (!input) return false;

      input.focus();

      if (input instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setter) return false;
        setter.call(input, ${JSON.stringify(text)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(text)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }

      await new Promise((resolve) => setTimeout(resolve, 300));

      const button = document.querySelector('button[data-testid="send-button"]')
        || document.querySelector('button[aria-label="Send prompt"]');
      if (button && button.getAttribute('aria-disabled') !== 'true' && !button.disabled) {
        button.click();
        return true;
      }

      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true
      }));
      return true;
    })();
  `,
  readyCheckScript: `
    Boolean(document.querySelector('#prompt-textarea[contenteditable="true"]')
      || document.querySelector('textarea#prompt-textarea'));
  `,
};
