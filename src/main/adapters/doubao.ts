import type { SiteAdapter } from './index';

export const doubaoAdapter: SiteAdapter = {
  urlPattern: /https:\/\/(?:www\.)?doubao\.com/i,
  injectScript: (text: string) => `
    (async () => {
      const input = document.querySelector('textarea')
        || document.querySelector('[contenteditable="true"][role="textbox"]')
        || document.querySelector('[contenteditable="true"]');
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
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      await new Promise((resolve) => setTimeout(resolve, 300));

      const visibleEnabledButtons = (root) => [...root.querySelectorAll('button')]
        .filter((button) => {
          const rect = button.getBoundingClientRect();
          const style = window.getComputedStyle(button);
          return rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && !button.disabled
            && button.getAttribute('aria-disabled') !== 'true';
        });

      let root = input;
      let buttons = [];
      for (let depth = 0; root && depth < 8; depth += 1) {
        buttons = visibleEnabledButtons(root);
        if (buttons.length >= 2) break;
        root = root.parentElement;
      }

      if (!buttons.length) {
        buttons = visibleEnabledButtons(document);
      }

      const inputRect = input.getBoundingClientRect();
      const button = buttons
        .map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
        .filter(({ rect }) => rect.bottom >= inputRect.top - 80)
        .sort((a, b) => (b.rect.bottom - a.rect.bottom) || (b.rect.right - a.rect.right))[0]?.candidate;

      if (button) {
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
    Boolean(document.querySelector('textarea')
      || document.querySelector('[contenteditable="true"][role="textbox"]')
      || document.querySelector('[contenteditable="true"]'));
  `,
};
