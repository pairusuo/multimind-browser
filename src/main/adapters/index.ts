import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { deepseekAdapter } from './deepseek';

export interface SiteAdapter {
  urlPattern: RegExp;
  injectScript: (text: string) => string;
  readyCheckScript: string;
}

export const adapters: SiteAdapter[] = [claudeAdapter, chatgptAdapter, deepseekAdapter];
