import type { SiteAdapter } from './index';

const extractDoubaoLatestResponseScript = `
  (() => {
    const getText = (element) => (element?.innerText || element?.textContent || '').trim();
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const isChrome = (element) => element.closest(
      'button, a, nav, aside, header, footer, textarea, input, [contenteditable="true"], [role="textbox"]'
    );
    const isUiText = (text) => /给豆包发送消息|内容由 AI 生成|内容由AI生成|深度思考|联网搜索|按 Enter|Shift\\+Enter|新建对话|历史记录/.test(text);
    const selectors = [
      '[data-testid*="message"]',
      '[class*="message"]',
      '[class*="markdown"]',
      '[class*="answer"]',
      '[class*="chat"] [class*="content"]',
      'main p',
      'main li',
      'main [dir="auto"]'
    ];
    const seen = new Set();
    const candidates = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((element) => {
        if (seen.has(element)) return false;
        seen.add(element);
        if (!isVisible(element) || isChrome(element)) return false;
        const text = getText(element);
        if (text.length < 20 || text.length > 8000 || isUiText(text)) return false;
        return !element.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]');
      })
      .map((element) => {
        let best = element;
        let current = element;
        for (let i = 0; i < 5 && current.parentElement; i += 1) {
          const parent = current.parentElement;
          if (parent === document.body || parent.tagName === 'MAIN') break;
          const text = getText(parent);
          if (text.length >= getText(best).length && text.length <= 8000 && !isUiText(text) && !isChrome(parent)) {
            best = parent;
          }
          current = parent;
        }
        return best;
      });

    const unique = [];
    const uniqueTexts = new Set();
    for (const candidate of candidates) {
      const text = getText(candidate);
      if (!uniqueTexts.has(text)) {
        uniqueTexts.add(text);
        unique.push({ element: candidate, text });
      }
    }

    return unique.at(-1)?.text || null;
  })();
`;

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
  extractLatestResponse: () => extractDoubaoLatestResponseScript,
  isResponseComplete: () => `
    (() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const stopControl = [...document.querySelectorAll('button, [role="button"]')].find((element) => {
        const label = [
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
          element.textContent
        ].filter(Boolean).join(' ').toLowerCase();
        return isVisible(element) && /(stop|停止|取消生成|停止生成|停止回答)/.test(label);
      });
      if (stopControl) return false;

      const text = ${extractDoubaoLatestResponseScript};
      const now = Date.now();
      const state = window.__multimindDoubaoReadState || { text: '', changedAt: now };
      if (text !== state.text) {
        window.__multimindDoubaoReadState = { text, changedAt: now };
        return false;
      }
      window.__multimindDoubaoReadState = state;
      return Boolean(text) && now - state.changedAt > 1500;
    })();
  `,
};
