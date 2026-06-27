import type { SiteAdapter } from './index';

const extractDeepSeekConversationScript = `
  (() => {
    const getText = (element) => (element?.innerText || element?.textContent || '').trim();
    const normalize = (text) => text.replace(/\\n{3,}/g, '\\n\\n').trim();
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const isChrome = (element) => element.closest(
      'textarea, input, [contenteditable="true"], button, nav, aside, header, footer, [role="button"]'
    );
    const isUiText = (text) => /给 DeepSeek 发送消息|深度思考|智能搜索|快速模式|内容由 AI 生成|探索未至之境|新对话|搜索历史/.test(text);
    const isConversationText = (text) => text.length >= 2 && text.length <= 12000 && !isUiText(text);
    const nearestMessageBlock = (element) => {
      let best = element;
      let current = element;
      for (let i = 0; i < 6 && current.parentElement; i += 1) {
        const parent = current.parentElement;
        if (parent === document.body || parent.tagName === 'MAIN') break;
        if (parent.querySelector('textarea, input, [contenteditable="true"]')) break;
        const text = normalize(getText(parent));
        const bestText = normalize(getText(best));
        const blockCount = parent.querySelectorAll('p, li, [class*="markdown"], [class*="message"]').length;
        if (text.length >= bestText.length && text.length <= 12000 && blockCount <= 35 && !isUiText(text)) {
          best = parent;
        }
        current = parent;
      }
      return best;
    };
    const getDescriptor = (element) => {
      const parts = [];
      let current = element;
      for (let i = 0; i < 5 && current; i += 1) {
        parts.push(
          current.getAttribute('data-message-author-role'),
          current.getAttribute('data-role'),
          current.getAttribute('role'),
          current.className?.toString(),
          current.getAttribute('aria-label')
        );
        current = current.parentElement;
      }
      return parts.filter(Boolean).join(' ').toLowerCase();
    };
    const classifyRole = (element, text, index) => {
      const descriptor = getDescriptor(element);
      const rect = element.getBoundingClientRect();
      if (rect.left > window.innerWidth * 0.35 && rect.right > window.innerWidth * 0.6) return 'user';
      if (/user|human|question|query|mine|self/.test(descriptor)) return 'user';
      if (/assistant|bot|answer|ds-assistant/.test(descriptor)) return 'assistant';
      return index % 2 === 0 ? 'user' : 'assistant';
    };
    const selectors = [
      '.ds-markdown.ds-assistant-message-main-content',
      '[class*="ds-assistant-message-main-content"]',
      '[class*="message-content"]',
      '[class*="message"]',
      '[class*="bubble"]',
      'main [dir="auto"]',
      'main p',
      'main li'
    ];
    const candidates = [];
    const seenElements = new Set();

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seenElements.has(element)) continue;
        seenElements.add(element);
        if (!isVisible(element) || isChrome(element)) continue;
        const block = nearestMessageBlock(element);
        if (seenElements.has(block)) continue;
        seenElements.add(block);
        const text = normalize(getText(block));
        if (!isConversationText(text)) continue;
        candidates.push({
          element: block,
          text,
          top: block.getBoundingClientRect().top,
        });
      }
    }

    const entries = [];
    const seenTexts = new Set();
    for (const candidate of candidates.sort((a, b) => a.top - b.top)) {
      if (seenTexts.has(candidate.text)) continue;
      if (entries.some((entry) => entry.content.includes(candidate.text) && entry.content.length > candidate.text.length)) continue;
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        if (candidate.text.includes(entries[i].content) && candidate.text.length > entries[i].content.length) {
          seenTexts.delete(entries[i].content);
          entries.splice(i, 1);
        }
      }
      seenTexts.add(candidate.text);
      entries.push({
        role: classifyRole(candidate.element, candidate.text, entries.length),
        content: candidate.text,
        order: candidate.top
      });
    }

    return entries.length ? { entries } : null;
  })();
`;

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

      const getInputText = () => input.value.trim();
      const isEnabledSendButton = (button) => button
        && button.getAttribute('aria-disabled') !== 'true'
        && !button.className?.toString().includes('disabled')
        && !button.disabled;
      const findSendButton = () => document.querySelector('button[aria-label="Send"]')
        || [...document.querySelectorAll('[role="button"].ds-button--primary, [role="button"][class*="ds-button--primary"], button')]
          .filter((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const style = window.getComputedStyle(candidate);
            return rect.width > 0
              && rect.height > 0
              && style.visibility !== 'hidden'
              && style.display !== 'none';
          })
          .at(-1);
      const waitForEnabledButton = async (timeout = 3000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const candidate = findSendButton();
          if (isEnabledSendButton(candidate)) return candidate;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      };
      const hasStopButton = () => [...document.querySelectorAll('button, [role="button"]')].some((candidate) => {
        const label = [
          candidate.getAttribute('aria-label'),
          candidate.getAttribute('title'),
          candidate.getAttribute('data-testid'),
          candidate.textContent
        ].filter(Boolean).join(' ').toLowerCase();
        const rect = candidate.getBoundingClientRect();
        const style = window.getComputedStyle(candidate);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && /(stop|停止|暂停|cancel)/.test(label);
      });
      const waitForSendAccepted = async (timeout = 8000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          if (!getInputText()) return true;
          if (hasStopButton()) return true;
          const candidate = findSendButton();
          if (candidate && !isEnabledSendButton(candidate)) return true;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return false;
      };

      const button = await waitForEnabledButton();
      if (button) {
        button.click();
        if (await waitForSendAccepted()) return true;
      }

      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
        composed: true
      }));
      return waitForSendAccepted();
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
  extractConversation: () => extractDeepSeekConversationScript,
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
