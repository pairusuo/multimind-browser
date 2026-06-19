import { LayoutMode } from './types';

export interface LayoutTemplate {
  id: string;
  name: string;
  layout: LayoutMode;
  siteIds: string[];
}

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  { id: 'big-four', name: '中美四强', layout: 'quad', siteIds: ['claude', 'chatgpt', 'deepseek', 'doubao'] },
  { id: 'china-two', name: '国产双雄', layout: 'horizontal', siteIds: ['deepseek', 'kimi'] },
  { id: 'us-two', name: '美国双雄', layout: 'horizontal', siteIds: ['claude', 'chatgpt'] },
];
