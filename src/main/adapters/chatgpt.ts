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

      const getInputText = () => input instanceof HTMLTextAreaElement
        ? input.value.trim()
        : (input.innerText || input.textContent || '').trim();
      const isEnabledButton = (button) => button
        && button.getAttribute('aria-disabled') !== 'true'
        && !button.disabled;
      const getSendButton = () => document.querySelector('button[data-testid="send-button"]')
        || document.querySelector('button[aria-label="Send prompt"]');
      const waitForEnabledButton = async (timeout = 3000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const button = getSendButton();
          if (isEnabledButton(button)) return button;
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
        cancelable: true
      }));
      return waitForInputToClear();
    })();
  `,
  readyCheckScript: `
    Boolean(document.querySelector('#prompt-textarea[contenteditable="true"]')
      || document.querySelector('textarea#prompt-textarea'));
  `,
  extractLatestResponse: () => `
    (() => {
      const getText = (element) => (element?.innerText || element?.textContent || '').trim();
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')]
        .filter((message) => isVisible(message));
      const latest = messages.at(-1);
      if (!latest) return null;

      const content = latest.querySelector('.markdown')
        || latest.querySelector('[data-message-id]')
        || latest;
      const text = getText(content);
      if (!text || /^(正在思考|已停止思考)$/.test(text)) return null;
      return text;
    })();
  `,
  isResponseComplete: () => `
    (() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const stopButton = document.querySelector('button[data-testid="stop-button"]')
        || [...document.querySelectorAll('button')].find((button) => {
          const label = [
            button.getAttribute('aria-label'),
            button.getAttribute('title'),
            button.getAttribute('data-testid')
          ].filter(Boolean).join(' ').toLowerCase();
          return isVisible(button) && /(stop-button|stop streaming|stop generating|停止生成|停止回答|停止响应|cancel response)/.test(label);
        });
      return !stopButton;
    })();
  `,
};
