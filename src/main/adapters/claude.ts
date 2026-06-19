import type { SiteAdapter } from './index';

export const claudeAdapter: SiteAdapter = {
  urlPattern: /https:\/\/claude\.ai/i,
  injectScript: (text: string) => `
    (async () => {
      const input = document.querySelector('div[contenteditable="true"][data-testid="chat-input"]')
        || document.querySelector('div[contenteditable="true"].ProseMirror')
        || [...document.querySelectorAll('div[contenteditable="true"]')].at(-1);
      if (!input) return false;
      input.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(text)});
      await new Promise((resolve) => setTimeout(resolve, 300));
      const button = document.querySelector('button[data-testid="send-button"]')
        || document.querySelector('button[aria-label="Send message"]');
      if (button && !button.disabled) {
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
    Boolean(document.querySelector('div[contenteditable="true"][data-testid="chat-input"]')
      || document.querySelector('div[contenteditable="true"].ProseMirror')
      || document.querySelector('div[contenteditable="true"]'));
  `,
};
