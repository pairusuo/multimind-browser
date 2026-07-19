import type { LayoutTemplate } from './presetTemplates';

export type LayoutMode = 'single' | 'horizontal' | 'vertical' | 'triple' | 'quad';
export type CellMode = 'chat' | 'search';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AppLanguage = 'zh' | 'en';

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
  GET_APP_VERSION: 'get-app-version',
  SEND_TO_ALL: 'send-to-all',
  START_NEW_DISCUSSION: 'start-new-discussion',
  FORWARD_RESPONSE: 'forward-response',
  GET_DOCUMENT_CANDIDATES: 'get-document-candidates',
  GENERATE_DOCUMENT: 'generate-document',
  CHOOSE_MEMORY_DIRECTORY: 'choose-memory-directory',
  LIST_MEMORY_SOURCES: 'list-memory-sources',
  REMOVE_MEMORY_SOURCE: 'remove-memory-source',
  SCAN_MEMORY_INBOX: 'scan-memory-inbox',
  GET_MEMORY_INBOX_DOCUMENT: 'get-memory-inbox-document',
  IMPORT_MEMORY_DOCUMENT: 'import-memory-document',
  SEARCH_MEMORY_DOCUMENTS: 'search-memory-documents',
  GET_MEMORY_DOCUMENT: 'get-memory-document',
  DISABLE_MEMORY_DOCUMENT: 'disable-memory-document',
  RECALL_MEMORY_FOR_AGENT_TASK: 'recall-memory-for-agent-task',
  APPLY_TEMPLATE: 'apply-template',
  SET_LAYOUT: 'set-layout',
  SET_OVERLAY_OPEN: 'set-overlay-open',
  SET_MAXIMIZED_CELL: 'set-maximized-cell',
  SET_SPLIT_RATIOS: 'set-split-ratios',
  NAVIGATE: 'navigate',
  NAVIGATE_BACK: 'navigate-back',
  NAVIGATE_FORWARD: 'navigate-forward',
  RELOAD: 'reload',
  SET_CELL_URL: 'set-cell-url',
  TOGGLE_CELL: 'toggle-cell',
  TOGGLE_MUTE: 'toggle-mute',
  NEW_TAB: 'new-tab',
  CLOSE_TAB: 'close-tab',
  SWITCH_TAB: 'switch-tab',
  SET_THEME_MODE: 'set-theme-mode',
  SET_LANGUAGE: 'set-language',
  SET_FORWARD_CONTROLS_ENABLED: 'set-forward-controls-enabled',
  CELL_FOCUSED: 'cell-focused',
  FORWARD_COMPLETED: 'forward-completed',
  SHOW_CELL_NOTICE: 'show-cell-notice',
  LAYOUT_CHANGED: 'layout-changed',
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

export interface ForwardResponsePayload {
  sourceCellId: string;
  targetCellId: string;
}

export interface GenerateDocumentPayload {
  summarizerCellId: string;
}

export interface MemoryImportSource {
  id: string;
  path: string;
  createdAt: number;
  lastScannedAt: number | null;
}

export interface RemoveMemorySourcePayload {
  id: string;
}

export type MemoryInboxStatus = 'new' | 'modified' | 'disabled' | 'imported';
export type MemoryDocumentType = 'profile' | 'project' | 'decision_rule' | 'event' | 'reference';
export type MemoryScope = 'global' | 'project';

export interface MemoryInboxItem {
  sourceId: string;
  sourcePath: string;
  filePath: string;
  fileName: string;
  title: string;
  hash: string;
  size: number;
  mtimeMs: number;
  status: MemoryInboxStatus;
  existingDocumentId?: string;
}

export interface MemoryInboxDocument {
  item: MemoryInboxItem;
  contentMarkdown: string;
  suggestedTitle: string;
  suggestedTags: string[];
}

export interface ImportMemoryDocumentPayload {
  sourceId?: string;
  sourcePath?: string;
  filePath?: string;
  title: string;
  memoryType?: MemoryDocumentType;
  memoryScope?: MemoryScope;
  originalQuestion?: string;
  participantSites?: string[];
  tags?: string[];
  contentMarkdown?: string;
}

export interface SearchMemoryDocumentsPayload {
  query: string;
}

export interface RecallMemoryForAgentTaskPayload {
  query: string;
}

export interface GetMemoryDocumentPayload {
  id: string;
}

export interface DisableMemoryDocumentPayload {
  id: string;
}

export interface MemoryDocumentSummary {
  id: string;
  title: string;
  originalQuestion: string;
  memoryType: MemoryDocumentType;
  memoryScope: MemoryScope;
  tags: string[];
  participantSites: string[];
  sourceType: string;
  sourcePath: string | null;
  sourceExists: boolean;
  createdAt: number;
  updatedAt: number;
  importedAt: number;
  version: number;
  snippet?: string;
}

export interface MemoryDocument extends MemoryDocumentSummary {
  contentMarkdown: string;
  sourceHash: string | null;
  sourceMtime: number | null;
  sourceSize: number | null;
}

export interface MemoryRecallItem {
  id: string;
  title: string;
  memoryType: MemoryDocumentType;
  memoryScope: MemoryScope;
  tags: string[];
  score: number;
  matchReasons: MemoryRecallReason[];
  scoreDetails: MemoryRecallScoreDetail[];
  excerpt: string;
}

export interface MemoryRecallScoreDetail {
  reason: MemoryRecallReason;
  score: number;
  matches?: string[];
}

export type MemoryRecallReason =
  | 'title'
  | 'tag'
  | 'body'
  | 'profile_priority'
  | 'decision_rule_priority'
  | 'project_scope'
  | 'global_scope'
  | 'recent';

export interface MemoryRecallContext {
  items: MemoryRecallItem[];
  agentContext: string;
}

export interface ExtractedConversationEntry {
  role: 'user' | 'assistant';
  content: string;
  domId?: string;
  order?: number;
}

export interface ExtractedConversation {
  entries: ExtractedConversationEntry[];
}

export interface ForwardRecord {
  id: string;
  sourceCellId: string;
  targetCellId: string;
  sourceContent: string;
  sourceTruncated: boolean;
  targetReply: string;
  timestamp: number;
}

export interface ForwardCompletedPayload {
  record: ForwardRecord;
}

export interface DocumentCandidate {
  cellId: string;
  url: string;
  active: boolean;
  hasTimeline: boolean;
}

export interface CellTab {
  id: string;
  title: string;
  url: string;
  favicon?: string;
}

export interface CellTabPayload {
  cellId: string;
  tabId?: string;
  url?: string;
}

export type NoticeType =
  | 'google-login-blocked'
  | 'inject-failed'
  | 'load-failed'
  | 'load-timeout'
  | 'source-response-pending'
  | 'conversation-truncated';

export interface CellNoticePayload {
  cellId: string;
  type: NoticeType;
  messageKey: string;
}

export interface SplitRatiosPayload {
  horizontalRatio?: number;
  verticalRatio?: number;
}

export interface SetMaximizedCellPayload {
  cellId: string | null;
}

export interface BrowserState {
  layoutMode: LayoutMode;
  cellUrls: Record<string, string>;
  cellModes: Record<string, CellMode>;
  searchUrlTemplates: Record<string, string>;
  activeCells: Record<string, boolean>;
  mutedCells: Record<string, boolean>;
  tabs: Record<string, CellTab[]>;
  activeTabIds: Record<string, string>;
  themeMode: ThemeMode;
  language: AppLanguage;
  forwardControlsEnabled: boolean;
  focusedCellId: string;
  maximizedCellId: string | null;
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

export interface LayoutChangedPayload {
  layoutMode: LayoutMode;
}

export interface ElectronAPI {
  getBrowserState: () => Promise<BrowserState>;
  getAppVersion: () => Promise<string>;
  applyTemplate: (payload: ApplyTemplatePayload) => Promise<BrowserState>;
  sendToAll: (payload: SendToAllPayload) => Promise<void>;
  startNewDiscussion: () => Promise<BrowserState>;
  forwardResponse: (payload: ForwardResponsePayload) => Promise<ForwardRecord>;
  getDocumentCandidates: () => Promise<DocumentCandidate[]>;
  generateDocument: (payload: GenerateDocumentPayload) => Promise<void>;
  chooseMemoryDirectory: () => Promise<MemoryImportSource | null>;
  listMemorySources: () => Promise<MemoryImportSource[]>;
  removeMemorySource: (payload: RemoveMemorySourcePayload) => Promise<void>;
  scanMemoryInbox: () => Promise<MemoryInboxItem[]>;
  getMemoryInboxDocument: (filePath: string) => Promise<MemoryInboxDocument>;
  importMemoryDocument: (payload: ImportMemoryDocumentPayload) => Promise<MemoryDocument>;
  searchMemoryDocuments: (payload: SearchMemoryDocumentsPayload) => Promise<MemoryDocumentSummary[]>;
  getMemoryDocument: (payload: GetMemoryDocumentPayload) => Promise<MemoryDocument | null>;
  disableMemoryDocument: (payload: DisableMemoryDocumentPayload) => Promise<void>;
  recallMemoryForAgentTask: (payload: RecallMemoryForAgentTaskPayload) => Promise<MemoryRecallContext>;
  setLayout: (mode: LayoutMode) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<BrowserState>;
  setLanguage: (language: AppLanguage) => Promise<BrowserState>;
  setForwardControlsEnabled: (enabled: boolean) => Promise<BrowserState>;
  setOverlayOpen: (open: boolean) => Promise<void>;
  setMaximizedCell: (payload: SetMaximizedCellPayload) => Promise<void>;
  setSplitRatios: (payload: SplitRatiosPayload) => Promise<void>;
  navigate: (payload: NavigatePayload) => Promise<BrowserState>;
  navigateBack: (cellId: string) => Promise<void>;
  navigateForward: (cellId: string) => Promise<void>;
  reload: (cellId: string) => Promise<void>;
  setCellUrl: (payload: SetCellUrlPayload) => Promise<void>;
  toggleCell: (payload: ToggleCellPayload) => Promise<void>;
  toggleMute: (cellId: string) => Promise<BrowserState>;
  newTab: (payload: CellTabPayload) => Promise<BrowserState>;
  closeTab: (payload: CellTabPayload) => Promise<BrowserState>;
  switchTab: (payload: CellTabPayload) => Promise<BrowserState>;
  focusCell: (payload: CellFocusedPayload) => Promise<void>;
  onCellFocused: (callback: (payload: CellFocusedPayload) => void) => () => void;
  onLayoutChanged: (callback: (payload: LayoutChangedPayload) => void) => () => void;
  onCellNotice: (callback: (payload: CellNoticePayload) => void) => () => void;
  onForwardCompleted: (callback: (payload: ForwardCompletedPayload) => void) => () => void;
  onCellUrlChanged: (callback: (payload: CellUrlChangedPayload) => void) => () => void;
  onCellTitleChanged: (callback: (payload: CellTitleChangedPayload) => void) => () => void;
  onCellFaviconChanged: (callback: (payload: CellFaviconChangedPayload) => void) => () => void;
}
