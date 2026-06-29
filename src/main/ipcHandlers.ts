import { app, ipcMain } from 'electron';
import {
  ApplyTemplatePayload,
  AppLanguage,
  CellTabPayload,
  ForwardResponsePayload,
  IPC,
  CellFocusedPayload,
  LayoutMode,
  NavigatePayload,
  SendToAllPayload,
  SetMaximizedCellPayload,
  SetCellUrlPayload,
  SplitRatiosPayload,
  ThemeMode,
  ToggleCellPayload,
} from '../shared/types';
import { WindowManager } from './windowManager';

export function registerIpcHandlers(windowManager: WindowManager): void {
  registerHandler(IPC.GET_BROWSER_STATE, () => windowManager.getBrowserState());

  registerHandler(IPC.GET_APP_VERSION, () => app.getVersion());

  registerHandler(IPC.APPLY_TEMPLATE, (_event, payload: ApplyTemplatePayload) => windowManager.applyTemplate(payload));

  registerHandler(IPC.SEND_TO_ALL, (_event, payload: SendToAllPayload) => {
    return windowManager.sendToAll(payload.text);
  });

  registerHandler(IPC.START_NEW_DISCUSSION, () => {
    return windowManager.startNewDiscussion();
  });

  registerHandler(IPC.FORWARD_RESPONSE, (_event, payload: ForwardResponsePayload) => {
    return windowManager.forwardResponse(payload);
  });

  registerHandler(IPC.SET_THEME_MODE, (_event, mode: ThemeMode) => {
    return windowManager.setThemeMode(mode);
  });

  registerHandler(IPC.SET_LANGUAGE, (_event, language: AppLanguage) => {
    return windowManager.setLanguage(language);
  });

  registerHandler(IPC.NEW_TAB, (_event, payload: CellTabPayload) => {
    return windowManager.newTab(payload.cellId, payload.url);
  });

  registerHandler(IPC.CLOSE_TAB, (_event, payload: CellTabPayload) => {
    return windowManager.closeTab(payload.cellId, payload.tabId);
  });

  registerHandler(IPC.SWITCH_TAB, (_event, payload: CellTabPayload) => {
    return windowManager.switchTab(payload.cellId, payload.tabId);
  });

  registerHandler(IPC.TOGGLE_MUTE, (_event, cellId: string) => {
    return windowManager.toggleMute(cellId);
  });

  registerHandler(IPC.NAVIGATE, (_event, payload: NavigatePayload) => {
    return windowManager.navigate(payload.cellId, payload.url);
  });

  registerHandler(IPC.NAVIGATE_BACK, (_event, cellId: string) => {
    windowManager.navigateBack(cellId);
  });

  registerHandler(IPC.NAVIGATE_FORWARD, (_event, cellId: string) => {
    windowManager.navigateForward(cellId);
  });

  registerHandler(IPC.RELOAD, (_event, cellId: string) => {
    windowManager.reload(cellId);
  });

  registerHandler(IPC.SET_LAYOUT, (_event, mode: LayoutMode) => {
    windowManager.setLayout(mode);
  });

  registerHandler(IPC.SET_OVERLAY_OPEN, (_event, open: boolean) => {
    windowManager.setOverlayOpen(open);
  });

  registerHandler(IPC.SET_MAXIMIZED_CELL, (_event, payload: SetMaximizedCellPayload) => {
    windowManager.setMaximizedCell(payload.cellId);
  });

  registerHandler(IPC.SET_SPLIT_RATIOS, (_event, payload: SplitRatiosPayload) => {
    windowManager.setSplitRatios(payload);
  });

  registerHandler(IPC.SET_CELL_URL, (_event, payload: SetCellUrlPayload) => {
    windowManager.setCellUrl(payload.cellId, payload.url, payload.mode, payload.searchUrlTemplate);
  });

  registerHandler(IPC.TOGGLE_CELL, (_event, payload: ToggleCellPayload) => {
    windowManager.toggleCell(payload.cellId, payload.active);
  });

  registerHandler(IPC.CELL_FOCUSED, (_event, payload: CellFocusedPayload) => {
    windowManager.focusCell(payload.cellId);
  });
}

function registerHandler(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}
