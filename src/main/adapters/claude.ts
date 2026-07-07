import type { SiteAdapter } from './index';

export const claudeAdapter: SiteAdapter = {
  urlPattern: /https:\/\/claude\.(ai|com)/i,
  injectScript: (text: string) => `
    (async () => {
      const input = document.querySelector('div[contenteditable="true"][data-testid="chat-input"]')
        || document.querySelector('div[contenteditable="true"].ProseMirror')
        || [...document.querySelectorAll('div[contenteditable="true"]')].at(-1);
      if (!input) return false;
      input.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(text)});
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const findComposer = () => {
        let element = input;
        for (let i = 0; i < 6 && element; i += 1) {
          if (element.querySelectorAll?.('button').length >= 2) {
            return element;
          }
          element = element.parentElement;
        }
        return input.closest('form') || input.parentElement;
      };
      const composer = findComposer();
      const buttonLabel = (button) => [
        button.getAttribute('aria-label'),
        button.getAttribute('title'),
        button.getAttribute('data-testid'),
        button.innerText
      ].filter(Boolean).join(' ').toLowerCase();
      const isEnabled = (candidate) => candidate
        && candidate.getAttribute('aria-disabled') !== 'true'
        && candidate.getAttribute('disabled') === null
        && !candidate.disabled
        && !candidate.className?.toString().includes('disabled');
      const isExcludedComposerButton = (button) => {
        const label = buttonLabel(button);
        return /attach|upload|add files|connector|microphone|record|voice|dictate|model|settings|附件|上传|添加|麦克风|录音|语音|模型|设置/.test(label);
      };
      const clickElement = (element) => {
        element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        element.click?.();
      };
      const currentInputText = () => (input.innerText || input.textContent || '').trim();
      const waitForInputToClear = async () => {
        for (let i = 0; i < 10; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          if (!currentInputText()) return true;
        }
        return false;
      };
      const pressEnter = async (modifiers = {}) => {
        input.focus();
        for (const type of ['keydown', 'keypress', 'keyup']) {
          input.dispatchEvent(new KeyboardEvent(type, {
            key: 'Enter',
            code: 'Enter',
            bubbles: true,
            cancelable: true,
            composed: true,
            ...modifiers
          }));
        }
        return waitForInputToClear();
      };
      const findSendButton = () => {
        const interactiveSelector = 'button, [role="button"], [aria-label], [tabindex]';
        const explicitButton = [...document.querySelectorAll(interactiveSelector)]
          .find((candidate) => {
            const label = buttonLabel(candidate);
            return isVisible(candidate)
              && isEnabled(candidate)
              && (/send|submit|发送|提交/.test(label) || candidate.getAttribute('type') === 'submit');
          });
        if (explicitButton) return explicitButton;

        const fallbackButtons = composer
          ? [...composer.querySelectorAll(interactiveSelector)]
              .filter((candidate) => isVisible(candidate) && isEnabled(candidate))
              .filter((candidate) => !isExcludedComposerButton(candidate))
              .sort((a, b) => a.getBoundingClientRect().right - b.getBoundingClientRect().right)
          : [];
        return fallbackButtons.at(-1);
      };

      const startedAt = Date.now();
      while (Date.now() - startedAt < 2500) {
        const button = findSendButton();
        if (button) {
          clickElement(button);
          if (await waitForInputToClear()) return true;
          if (await pressEnter({ metaKey: true })) return true;
          if (await pressEnter({ ctrlKey: true })) return true;
          if (await pressEnter()) return true;
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await pressEnter({ metaKey: true });
      return true;
    })();
  `,
  readyCheckScript: `
    Boolean(document.querySelector('div[contenteditable="true"][data-testid="chat-input"]')
      || document.querySelector('div[contenteditable="true"].ProseMirror')
      || document.querySelector('div[contenteditable="true"]'));
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
        '[data-testid="message-content"]',
        '[class*="font-claude-message"]',
        '[data-message-author-role="assistant"]',
        '[class*="standard-markdown"]'
      ];
      const seen = new Set();
      const candidates = selectors
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .filter((element) => {
          if (seen.has(element)) return false;
          seen.add(element);
          if (!isVisible(element)) return false;
          if (element.closest('button, a, nav, aside, header, footer, [contenteditable="true"], textarea, input')) {
            return false;
          }
          if (element.closest('[data-testid="user-message"], [data-message-author-role="user"]')) return false;
          return getText(element).length > 0;
        });

      const latest = candidates.at(-1);
      if (latest) return getText(latest);

      const fallbackBlocks = [...document.querySelectorAll('p, li, pre')]
        .filter((element) => {
          if (!isVisible(element)) return false;
          if (element.closest('button, a, nav, aside, header, footer, [contenteditable="true"], textarea, input')) {
            return false;
          }
          const text = getText(element);
          return text.length > 0
            && !/Claude is AI|Write a message|How can I help|Free plan|Try Team/i.test(text);
        });

      const containers = [];
      const seenContainers = new Set();
      for (const block of fallbackBlocks) {
        let current = block;
        let best = block;
        for (let i = 0; i < 7 && current.parentElement; i += 1) {
          const parent = current.parentElement;
          if (parent === document.body || parent.tagName === 'MAIN') break;
          const parentText = getText(parent);
          const blockCount = parent.querySelectorAll('p, li, pre').length;
          if (parentText.length > 0 && parentText.length < 5000 && blockCount <= 20) {
            best = parent;
          }
          current = parent;
        }
        if (!seenContainers.has(best)) {
          seenContainers.add(best);
          containers.push(best);
        }
      }

      const fallback = containers
        .map((element) => getText(element))
        .filter((text) => text.length > 20)
        .at(-1);
      return fallback || null;
    })();
  `,
  extractConversation: () => buildClaudeConversationScript(),
  isResponseComplete: () => `
    (() => {
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const stopButton = [...document.querySelectorAll('button')].find((button) => {
        const label = [
          button.getAttribute('aria-label'),
          button.getAttribute('title'),
          button.getAttribute('data-testid'),
          button.innerText
        ].filter(Boolean).join(' ').toLowerCase();
        return isVisible(button) && /(stop response|stop generating|stop responding|停止生成|停止回答|停止响应)/.test(label);
      });
      return !stopButton;
    })();
  `,
};

function buildClaudeConversationScript(): string {
  return `
    (() => {
      const getText = (element) => (element?.innerText || element?.textContent || '').trim();
      const normalize = (text) => text.replace(/\\n{3,}/g, '\\n\\n').trim();
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const isUiText = (text) => /Claude is AI|Claude can make mistakes|Write a message|How can I help|Free plan|Try Team|Retry|Copy|Share|Like|Dislike|Artifacts|Attach|Upload/i.test(text);
      const cleanMessageText = (element) => {
        const clone = element.cloneNode(true);
        clone.querySelectorAll?.([
          'button',
          'nav',
          'aside',
          'header',
          'footer',
          'textarea',
          'input',
          '[contenteditable="true"]',
          '[role="button"]',
          '[aria-hidden="true"]',
          '[data-testid*="copy"]',
          '[data-testid*="feedback"]',
          '[class*="toolbar"]',
          '[class*="actions"]'
        ].join(',')).forEach((child) => child.remove());
        return normalize(getText(clone));
      };
      const nearestTurn = (element) => {
        let current = element;
        for (let depth = 0; depth < 8 && current?.parentElement; depth += 1) {
          const parent = current.parentElement;
          if (parent === document.body || parent.tagName === 'MAIN') break;
          const hasUser = parent.querySelector('[data-testid="user-message"], [data-message-author-role="user"]');
          const hasAssistant = parent.querySelector('[data-testid="message-content"], [class*="font-claude-message"], [class*="standard-markdown"], [data-message-author-role="assistant"]');
          if ((hasUser || hasAssistant) && !parent.querySelector('div[contenteditable="true"][data-testid="chat-input"], textarea, input')) {
            current = parent;
            continue;
          }
          break;
        }
        return current || element;
      };
      const getOrder = (element, fallback) => {
        const rect = element.getBoundingClientRect();
        return Number.isFinite(rect.top) ? rect.top : fallback;
      };
      const roleCandidates = [];

      [...document.querySelectorAll('[data-testid="user-message"], [data-message-author-role="user"]')]
        .filter(isVisible)
        .forEach((node, index) => {
          roleCandidates.push({
            role: 'user',
            root: node,
            contentRoot: node,
            order: getOrder(nearestTurn(node), index)
          });
        });

      const assistantSelectors = [
        '[data-testid="message-content"]',
        '[class*="font-claude-message"]',
        '[data-message-author-role="assistant"]',
        '[class*="standard-markdown"]'
      ];
      const seenAssistant = new Set();
      assistantSelectors
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .filter((node) => {
          if (seenAssistant.has(node)) return false;
          seenAssistant.add(node);
          if (!isVisible(node)) return false;
          if (node.closest('[data-testid="user-message"], [data-message-author-role="user"]')) return false;
          if (node.closest('button, a, nav, aside, header, footer, [contenteditable="true"], textarea, input')) return false;
          return true;
        })
        .forEach((node, index) => {
          roleCandidates.push({
            role: 'assistant',
            root: node,
            contentRoot: node.querySelector('[class*="standard-markdown"]') || node,
            order: getOrder(nearestTurn(node), index + 10000)
          });
        });

      const entries = [];
      const seen = new Set();
      for (const candidate of roleCandidates.sort((a, b) => a.order - b.order)) {
        const content = cleanMessageText(candidate.contentRoot);
        if (!content || content.length < 2 || content.length > 12000 || isUiText(content)) continue;
        const key = candidate.role + '|' + content;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          role: candidate.role,
          content,
          domId: candidate.root.getAttribute('data-testid') || candidate.root.getAttribute('data-message-id') || undefined,
          order: candidate.order
        });
      }

      if (!entries.length) return null;

      const deduped = [];
      for (const entry of entries) {
        if (deduped.some((item) => item.role === entry.role && item.content === entry.content)) continue;
        if (deduped.some((item) => item.role === entry.role && item.content.includes(entry.content) && item.content.length > entry.content.length)) continue;
        for (let i = deduped.length - 1; i >= 0; i -= 1) {
          if (
            deduped[i].role === entry.role
            && entry.content.includes(deduped[i].content)
            && entry.content.length > deduped[i].content.length
          ) {
            deduped.splice(i, 1);
          }
        }
        deduped.push(entry);
      }

      return {
        entries: deduped.map((entry) => ({
          role: entry.role,
          content: entry.content,
          ...(entry.domId ? { domId: entry.domId } : {}),
          order: entry.order
        }))
      };
    })();
  `;
}
