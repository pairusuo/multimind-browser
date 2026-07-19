import { contextBridge, ipcRenderer } from 'electron';
import {
  ApplyTemplatePayload,
  AppLanguage,
  BrowserState,
  CellTabPayload,
  CellFaviconChangedPayload,
  CellFocusedPayload,
  DisableMemoryDocumentPayload,
  ForwardCompletedPayload,
  ForwardResponsePayload,
  GetMemoryDocumentPayload,
  LayoutChangedPayload,
  CellNoticePayload,
  CellTitleChangedPayload,
  CellUrlChangedPayload,
  DocumentCandidate,
  ElectronAPI,
  GenerateDocumentPayload,
  ImportMemoryDocumentPayload,
  IPC,
  NavigatePayload,
  RecallMemoryForAgentTaskPayload,
  RemoveMemorySourcePayload,
  SearchMemoryDocumentsPayload,
  SendToAllPayload,
  SetMaximizedCellPayload,
  SetCellUrlPayload,
  SplitRatiosPayload,
  ThemeMode,
  ToggleCellPayload,
} from '../shared/types';

const api: ElectronAPI = {
  getBrowserState: () => ipcRenderer.invoke(IPC.GET_BROWSER_STATE) as Promise<BrowserState>,
  getAppVersion: () => ipcRenderer.invoke(IPC.GET_APP_VERSION) as Promise<string>,
  applyTemplate: (payload: ApplyTemplatePayload) => ipcRenderer.invoke(IPC.APPLY_TEMPLATE, payload),
  sendToAll: (payload: SendToAllPayload) => ipcRenderer.invoke(IPC.SEND_TO_ALL, payload),
  startNewDiscussion: () => ipcRenderer.invoke(IPC.START_NEW_DISCUSSION),
  forwardResponse: (payload: ForwardResponsePayload) => ipcRenderer.invoke(IPC.FORWARD_RESPONSE, payload),
  getDocumentCandidates: () => ipcRenderer.invoke(IPC.GET_DOCUMENT_CANDIDATES) as Promise<DocumentCandidate[]>,
  generateDocument: (payload: GenerateDocumentPayload) => ipcRenderer.invoke(IPC.GENERATE_DOCUMENT, payload) as Promise<void>,
  chooseMemoryDirectory: () => ipcRenderer.invoke(IPC.CHOOSE_MEMORY_DIRECTORY),
  listMemorySources: () => ipcRenderer.invoke(IPC.LIST_MEMORY_SOURCES),
  removeMemorySource: (payload: RemoveMemorySourcePayload) => ipcRenderer.invoke(IPC.REMOVE_MEMORY_SOURCE, payload),
  scanMemoryInbox: () => ipcRenderer.invoke(IPC.SCAN_MEMORY_INBOX),
  getMemoryInboxDocument: (filePath: string) => ipcRenderer.invoke(IPC.GET_MEMORY_INBOX_DOCUMENT, filePath),
  importMemoryDocument: (payload: ImportMemoryDocumentPayload) => ipcRenderer.invoke(IPC.IMPORT_MEMORY_DOCUMENT, payload),
  searchMemoryDocuments: (payload: SearchMemoryDocumentsPayload) => ipcRenderer.invoke(IPC.SEARCH_MEMORY_DOCUMENTS, payload),
  getMemoryDocument: (payload: GetMemoryDocumentPayload) => ipcRenderer.invoke(IPC.GET_MEMORY_DOCUMENT, payload),
  disableMemoryDocument: (payload: DisableMemoryDocumentPayload) => ipcRenderer.invoke(IPC.DISABLE_MEMORY_DOCUMENT, payload),
  recallMemoryForAgentTask: (payload: RecallMemoryForAgentTaskPayload) => ipcRenderer.invoke(IPC.RECALL_MEMORY_FOR_AGENT_TASK, payload),
  setLayout: (mode) => ipcRenderer.invoke(IPC.SET_LAYOUT, mode),
  setThemeMode: (mode: ThemeMode) => ipcRenderer.invoke(IPC.SET_THEME_MODE, mode),
  setLanguage: (language: AppLanguage) => ipcRenderer.invoke(IPC.SET_LANGUAGE, language),
  setForwardControlsEnabled: (enabled: boolean) => ipcRenderer.invoke(IPC.SET_FORWARD_CONTROLS_ENABLED, enabled),
  setOverlayOpen: (open: boolean) => ipcRenderer.invoke(IPC.SET_OVERLAY_OPEN, open),
  setMaximizedCell: (payload: SetMaximizedCellPayload) => ipcRenderer.invoke(IPC.SET_MAXIMIZED_CELL, payload),
  setSplitRatios: (payload: SplitRatiosPayload) => ipcRenderer.invoke(IPC.SET_SPLIT_RATIOS, payload),
  navigate: (payload: NavigatePayload) => ipcRenderer.invoke(IPC.NAVIGATE, payload),
  navigateBack: (cellId: string) => ipcRenderer.invoke(IPC.NAVIGATE_BACK, cellId),
  navigateForward: (cellId: string) => ipcRenderer.invoke(IPC.NAVIGATE_FORWARD, cellId),
  reload: (cellId: string) => ipcRenderer.invoke(IPC.RELOAD, cellId),
  setCellUrl: (payload: SetCellUrlPayload) => ipcRenderer.invoke(IPC.SET_CELL_URL, payload),
  toggleCell: (payload: ToggleCellPayload) => ipcRenderer.invoke(IPC.TOGGLE_CELL, payload),
  toggleMute: (cellId: string) => ipcRenderer.invoke(IPC.TOGGLE_MUTE, cellId),
  newTab: (payload: CellTabPayload) => ipcRenderer.invoke(IPC.NEW_TAB, payload),
  closeTab: (payload: CellTabPayload) => ipcRenderer.invoke(IPC.CLOSE_TAB, payload),
  switchTab: (payload: CellTabPayload) => ipcRenderer.invoke(IPC.SWITCH_TAB, payload),
  focusCell: (payload: CellFocusedPayload) => ipcRenderer.invoke(IPC.CELL_FOCUSED, payload),
  onCellFocused: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellFocusedPayload) => callback(payload);
    ipcRenderer.on(IPC.CELL_FOCUSED, listener);
    return () => ipcRenderer.removeListener(IPC.CELL_FOCUSED, listener);
  },
  onLayoutChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LayoutChangedPayload) => callback(payload);
    ipcRenderer.on(IPC.LAYOUT_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.LAYOUT_CHANGED, listener);
  },
  onCellNotice: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellNoticePayload) => callback(payload);
    ipcRenderer.on(IPC.SHOW_CELL_NOTICE, listener);
    return () => ipcRenderer.removeListener(IPC.SHOW_CELL_NOTICE, listener);
  },
  onForwardCompleted: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ForwardCompletedPayload) => callback(payload);
    ipcRenderer.on(IPC.FORWARD_COMPLETED, listener);
    return () => ipcRenderer.removeListener(IPC.FORWARD_COMPLETED, listener);
  },
  onCellUrlChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellUrlChangedPayload) => callback(payload);
    ipcRenderer.on(IPC.CELL_URL_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.CELL_URL_CHANGED, listener);
  },
  onCellTitleChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellTitleChangedPayload) => callback(payload);
    ipcRenderer.on(IPC.CELL_TITLE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.CELL_TITLE_CHANGED, listener);
  },
  onCellFaviconChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellFaviconChangedPayload) => callback(payload);
    ipcRenderer.on(IPC.CELL_FAVICON_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.CELL_FAVICON_CHANGED, listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
