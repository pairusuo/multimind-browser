import { ipcMain } from 'electron';
import {
  ApplyTemplatePayload,
  IPC,
  CellFocusedPayload,
  LayoutMode,
  NavigatePayload,
  SendToAllPayload,
  SetCellUrlPayload,
  SplitRatiosPayload,
  ToggleCellPayload,
} from '../shared/types';
import { WindowManager } from './windowManager';

export function registerIpcHandlers(windowManager: WindowManager): void {
  ipcMain.handle(IPC.GET_BROWSER_STATE, () => windowManager.getBrowserState());

  ipcMain.handle(IPC.APPLY_TEMPLATE, (_event, payload: ApplyTemplatePayload) => windowManager.applyTemplate(payload));

  ipcMain.handle(IPC.SEND_TO_ALL, (_event, payload: SendToAllPayload) => {
    return windowManager.sendToAll(payload.text);
  });

  ipcMain.handle(IPC.NAVIGATE, (_event, payload: NavigatePayload) => {
    windowManager.navigate(payload.cellId, payload.url);
  });

  ipcMain.handle(IPC.NAVIGATE_BACK, (_event, cellId: string) => {
    windowManager.navigateBack(cellId);
  });

  ipcMain.handle(IPC.NAVIGATE_FORWARD, (_event, cellId: string) => {
    windowManager.navigateForward(cellId);
  });

  ipcMain.handle(IPC.RELOAD, (_event, cellId: string) => {
    windowManager.reload(cellId);
  });

  ipcMain.handle(IPC.SET_LAYOUT, (_event, mode: LayoutMode) => {
    windowManager.setLayout(mode);
  });

  ipcMain.handle(IPC.SET_OVERLAY_OPEN, (_event, open: boolean) => {
    windowManager.setOverlayOpen(open);
  });

  ipcMain.handle(IPC.SET_SPLIT_RATIOS, (_event, payload: SplitRatiosPayload) => {
    windowManager.setSplitRatios(payload);
  });

  ipcMain.handle(IPC.SET_CELL_URL, (_event, payload: SetCellUrlPayload) => {
    windowManager.setCellUrl(payload.cellId, payload.url, payload.mode, payload.searchUrlTemplate);
  });

  ipcMain.handle(IPC.TOGGLE_CELL, (_event, payload: ToggleCellPayload) => {
    windowManager.toggleCell(payload.cellId, payload.active);
  });

  ipcMain.handle(IPC.CELL_FOCUSED, (_event, payload: CellFocusedPayload) => {
    windowManager.focusCell(payload.cellId);
  });
}
