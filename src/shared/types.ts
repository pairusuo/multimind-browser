import type { LayoutTemplate } from './presetTemplates';

export type LayoutMode = 'single' | 'horizontal' | 'vertical' | 'triple' | 'quad';
export type CellMode = 'chat' | 'search';

export interface CellConfig {
  id: string;
  defaultUrl: string;
  active: boolean;
}

export const CELL_IDS = ['cell-0', 'cell-1', 'cell-2', 'cell-3'] as const;

export const DEFAULT_URLS: Record<string, string> = {
  'cell-0': 'https://claude.ai',
  'cell-1': 'https://chatgpt.com',
  'cell-2': 'https://chat.deepseek.com',
  'cell-3': 'https://www.doubao.com',
};

export const LAYOUT_CELLS: Record<LayoutMode, string[]> = {
  single: ['cell-0'],
  horizontal: ['cell-0', 'cell-1'],
  vertical: ['cell-0', 'cell-1'],
  triple: ['cell-0', 'cell-1', 'cell-2'],
  quad: ['cell-0', 'cell-1', 'cell-2', 'cell-3'],
};

export const IPC = {
  GET_BROWSER_STATE: 'get-browser-state',
  SEND_TO_ALL: 'send-to-all',
  APPLY_TEMPLATE: 'apply-template',
  SET_LAYOUT: 'set-layout',
  SET_OVERLAY_OPEN: 'set-overlay-open',
  SET_SPLIT_RATIOS: 'set-split-ratios',
  NAVIGATE: 'navigate',
  NAVIGATE_BACK: 'navigate-back',
  NAVIGATE_FORWARD: 'navigate-forward',
  RELOAD: 'reload',
  SET_CELL_URL: 'set-cell-url',
  TOGGLE_CELL: 'toggle-cell',
  CELL_FOCUSED: 'cell-focused',

  SHOW_CELL_NOTICE: 'show-cell-notice',
  CELL_URL_CHANGED: 'cell-url-changed',
  CELL_TITLE_CHANGED: 'cell-title-changed',
  CELL_FAVICON_CHANGED: 'cell-favicon-changed',
} as const;

export interface NavigatePayload {
  cellId: string;
  url: string;
}

export interface SetCellUrlPayload {
  cellId: string;
  url: string;
  mode?: CellMode;
  searchUrlTemplate?: string;
}

export interface ToggleCellPayload {
  cellId: string;
  active: boolean;
}

export interface CellFocusedPayload {
  cellId: string;
}

export interface SendToAllPayload {
  text: string;
}

export type NoticeType = 'google-login-blocked' | 'inject-failed' | 'load-failed';

export interface CellNoticePayload {
  cellId: string;
  type: NoticeType;
  message: string;
}

export interface SplitRatiosPayload {
  horizontalRatio?: number;
  verticalRatio?: number;
}

export interface BrowserState {
  layoutMode: LayoutMode;
  cellUrls: Record<string, string>;
  cellModes: Record<string, CellMode>;
  searchUrlTemplates: Record<string, string>;
  activeCells: Record<string, boolean>;
  focusedCellId: string;
  hasCompletedOnboarding: boolean;
}

export interface ApplyTemplatePayload {
  template: LayoutTemplate;
}

export interface CellUrlChangedPayload {
  cellId: string;
  url: string;
}

export interface CellTitleChangedPayload {
  cellId: string;
  title: string;
}

export interface CellFaviconChangedPayload {
  cellId: string;
  favicon: string;
}

export interface ElectronAPI {
  getBrowserState: () => Promise<BrowserState>;
  applyTemplate: (payload: ApplyTemplatePayload) => Promise<BrowserState>;
  sendToAll: (payload: SendToAllPayload) => Promise<void>;
  setLayout: (mode: LayoutMode) => Promise<void>;
  setOverlayOpen: (open: boolean) => Promise<void>;
  setSplitRatios: (payload: SplitRatiosPayload) => Promise<void>;
  navigate: (payload: NavigatePayload) => Promise<void>;
  navigateBack: (cellId: string) => Promise<void>;
  navigateForward: (cellId: string) => Promise<void>;
  reload: (cellId: string) => Promise<void>;
  setCellUrl: (payload: SetCellUrlPayload) => Promise<void>;
  toggleCell: (payload: ToggleCellPayload) => Promise<void>;
  focusCell: (payload: CellFocusedPayload) => Promise<void>;
  onCellFocused: (callback: (payload: CellFocusedPayload) => void) => () => void;
  onCellNotice: (callback: (payload: CellNoticePayload) => void) => () => void;
  onCellUrlChanged: (callback: (payload: CellUrlChangedPayload) => void) => () => void;
  onCellTitleChanged: (callback: (payload: CellTitleChangedPayload) => void) => () => void;
  onCellFaviconChanged: (callback: (payload: CellFaviconChangedPayload) => void) => () => void;
}
