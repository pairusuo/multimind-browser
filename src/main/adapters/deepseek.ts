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
        || [...document.querySelectorAll('[role="button"].ds-button--primary, [role="button"][class*="ds-button--primary"], button')].at(-1);
      if (button
        && button.getAttribute('aria-disabled') !== 'true'
        && !button.className?.toString().includes('disabled')
        && !button.disabled) {
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
  extractLatestResponse: () => `
    (() => {
      const getText = (element) => (element?.innerText || element?.textContent || '').trim();
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const selectors = [
        '.ds-markdown.ds-assistant-message-main-content',
        '[class*="ds-assistant-message-main-content"]',
        '[class*="message-content"]',
        '[data-message-author-role="assistant"]'
      ];
      const seen = new Set();
      const candidates = selectors
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .filter((element) => {
          if (seen.has(element)) return false;
          seen.add(element);
          if (!isVisible(element)) return false;
          if (element.closest('textarea, [contenteditable="true"], button, nav, aside, header, footer')) return false;
          return getText(element).length > 0;
        });

      const latest = candidates.at(-1);
      return latest ? getText(latest) : null;
    })();
  `,
  isResponseComplete: () => `
    (() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const getLatestText = () => {
        const getText = (element) => (element?.innerText || element?.textContent || '').trim();
        const messages = [...document.querySelectorAll('.ds-markdown.ds-assistant-message-main-content, [class*="ds-assistant-message-main-content"]')]
          .filter((element) => isVisible(element) && getText(element).length > 0);
        return getText(messages.at(-1));
      };
      const stopButton = [...document.querySelectorAll('button')].find((button) => {
        const label = [
          button.getAttribute('aria-label'),
          button.getAttribute('title'),
          button.getAttribute('data-testid')
        ].filter(Boolean).join(' ').toLowerCase();
        return isVisible(button) && /(stop|停止生成|停止回答|停止响应|cancel response)/.test(label);
      });
      if (stopButton) return false;

      const text = getLatestText();
      const now = Date.now();
      const state = window.__multimindDeepSeekReadState || { text: '', changedAt: now };
      if (text !== state.text) {
        window.__multimindDeepSeekReadState = { text, changedAt: now };
        return false;
      }
      window.__multimindDeepSeekReadState = state;
      return Boolean(text) && now - state.changedAt > 1500;
    })();
  `,
};
