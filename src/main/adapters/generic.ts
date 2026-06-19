import type { SiteAdapter } from './index';

interface GenericAdapterOptions {
  urlPattern: RegExp;
  selectors?: string[];
  sendButtonSelectors?: string[];
}

const DEFAULT_INPUT_SELECTORS = [
  'textarea:not([disabled])',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
];

const DEFAULT_SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send"]',
  'button[aria-label="Send message"]',
  'button[aria-label="Send prompt"]',
  'button[type="submit"]',
];

export function createGenericChatAdapter({
  urlPattern,
  selectors = DEFAULT_INPUT_SELECTORS,
  sendButtonSelectors = DEFAULT_SEND_BUTTON_SELECTORS,
}: GenericAdapterOptions): SiteAdapter {
  return {
    urlPattern,
    injectScript: (text: string) => `
      (async () => {
        const inputSelectors = ${JSON.stringify(selectors)};
        const sendButtonSelectors = ${JSON.stringify(sendButtonSelectors)};

        const input = inputSelectors
          .flatMap((selector) => [...document.querySelectorAll(selector)])
          .find((element) => element instanceof HTMLTextAreaElement
            || element.getAttribute('contenteditable') === 'true');
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

        await new Promise((resolve) => setTimeout(resolve, 250));

        const button = sendButtonSelectors
          .map((selector) => document.querySelector(selector))
          .find(Boolean)
          || [...document.querySelectorAll('button')].reverse().find((candidate) => {
            const label = [
              candidate.getAttribute('aria-label'),
              candidate.getAttribute('title'),
              candidate.textContent,
            ].filter(Boolean).join(' ').toLowerCase();
            return /send|发送|提交|arrow|paper/i.test(label);
          });

        if (button && button.getAttribute('aria-disabled') !== 'true' && !button.disabled) {
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
      ${JSON.stringify(selectors)}.some((selector) => document.querySelector(selector));
    `,
  };
}
