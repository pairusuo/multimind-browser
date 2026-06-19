import { contextBridge, ipcRenderer } from 'electron';
import {
  ApplyTemplatePayload,
  BrowserState,
  CellFaviconChangedPayload,
  CellFocusedPayload,
  CellNoticePayload,
  CellTitleChangedPayload,
  CellUrlChangedPayload,
  ElectronAPI,
  IPC,
  NavigatePayload,
  SetCellUrlPayload,
  SplitRatiosPayload,
  ToggleCellPayload,
} from '../shared/types';

const api: ElectronAPI = {
  getBrowserState: () => ipcRenderer.invoke(IPC.GET_BROWSER_STATE) as Promise<BrowserState>,
  applyTemplate: (payload: ApplyTemplatePayload) => ipcRenderer.invoke(IPC.APPLY_TEMPLATE, payload),
  setLayout: (mode) => ipcRenderer.invoke(IPC.SET_LAYOUT, mode),
  setOverlayOpen: (open: boolean) => ipcRenderer.invoke(IPC.SET_OVERLAY_OPEN, open),
  setSplitRatios: (payload: SplitRatiosPayload) => ipcRenderer.invoke(IPC.SET_SPLIT_RATIOS, payload),
  navigate: (payload: NavigatePayload) => ipcRenderer.invoke(IPC.NAVIGATE, payload),
  navigateBack: (cellId: string) => ipcRenderer.invoke(IPC.NAVIGATE_BACK, cellId),
  navigateForward: (cellId: string) => ipcRenderer.invoke(IPC.NAVIGATE_FORWARD, cellId),
  reload: (cellId: string) => ipcRenderer.invoke(IPC.RELOAD, cellId),
  setCellUrl: (payload: SetCellUrlPayload) => ipcRenderer.invoke(IPC.SET_CELL_URL, payload),
  toggleCell: (payload: ToggleCellPayload) => ipcRenderer.invoke(IPC.TOGGLE_CELL, payload),
  focusCell: (payload: CellFocusedPayload) => ipcRenderer.invoke(IPC.CELL_FOCUSED, payload),
  onCellFocused: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellFocusedPayload) => callback(payload);
    ipcRenderer.on(IPC.CELL_FOCUSED, listener);
    return () => ipcRenderer.removeListener(IPC.CELL_FOCUSED, listener);
  },
  onCellNotice: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CellNoticePayload) => callback(payload);
    ipcRenderer.on(IPC.SHOW_CELL_NOTICE, listener);
    return () => ipcRenderer.removeListener(IPC.SHOW_CELL_NOTICE, listener);
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
