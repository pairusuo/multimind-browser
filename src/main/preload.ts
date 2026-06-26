import { contextBridge, ipcRenderer } from 'electron';
import {
  ApplyTemplatePayload,
  BrowserState,
  CellTabPayload,
  CellFaviconChangedPayload,
  CellFocusedPayload,
  ForwardCompletedPayload,
  ForwardResponsePayload,
  LayoutChangedPayload,
  CellNoticePayload,
  CellTitleChangedPayload,
  CellUrlChangedPayload,
  ElectronAPI,
  IPC,
  NavigatePayload,
  SendToAllPayload,
  SetCellUrlPayload,
  SplitRatiosPayload,
  ThemeMode,
  ToggleCellPayload,
} from '../shared/types';

const api: ElectronAPI = {
  getBrowserState: () => ipcRenderer.invoke(IPC.GET_BROWSER_STATE) as Promise<BrowserState>,
  applyTemplate: (payload: ApplyTemplatePayload) => ipcRenderer.invoke(IPC.APPLY_TEMPLATE, payload),
  sendToAll: (payload: SendToAllPayload) => ipcRenderer.invoke(IPC.SEND_TO_ALL, payload),
  forwardResponse: (payload: ForwardResponsePayload) => ipcRenderer.invoke(IPC.FORWARD_RESPONSE, payload),
  setLayout: (mode) => ipcRenderer.invoke(IPC.SET_LAYOUT, mode),
  setThemeMode: (mode: ThemeMode) => ipcRenderer.invoke(IPC.SET_THEME_MODE, mode),
  setOverlayOpen: (open: boolean) => ipcRenderer.invoke(IPC.SET_OVERLAY_OPEN, open),
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
