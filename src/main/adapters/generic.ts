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

        const getInputText = () => input instanceof HTMLTextAreaElement
          ? input.value.trim()
          : (input.innerText || input.textContent || '').trim();
        const isVisible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const isEnabledButton = (button) => button
          && button.getAttribute('aria-disabled') !== 'true'
          && !button.disabled
          && !button.className?.toString().includes('disabled');
        const findSendButton = () => sendButtonSelectors
          .map((selector) => document.querySelector(selector))
          .find((button) => isVisible(button) && isEnabledButton(button))
          || [...document.querySelectorAll('button')].reverse().find((candidate) => {
            const label = [
              candidate.getAttribute('aria-label'),
              candidate.getAttribute('title'),
              candidate.textContent,
            ].filter(Boolean).join(' ').toLowerCase();
            return isVisible(candidate) && isEnabledButton(candidate) && /send|发送|提交|arrow|paper/i.test(label);
          });
        const waitForEnabledButton = async (timeout = 3000) => {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            const button = findSendButton();
            if (button) return button;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        };
        const waitForInputToClear = async (timeout = 1200) => {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            if (!getInputText()) return true;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return false;
        };

        const button = await waitForEnabledButton();
        if (button) {
          button.click();
          if (await waitForInputToClear()) return true;
        }

        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
          composed: true
        }));
        return waitForInputToClear();
      })();
    `,
    readyCheckScript: `
      ${JSON.stringify(selectors)}.some((selector) => document.querySelector(selector));
    `,
  };
}
