import { app, BrowserWindow, dialog, ipcMain, OpenDialogOptions } from 'electron';
import {
  ApplyTemplatePayload,
  AppLanguage,
  CellTabPayload,
  DisableMemoryDocumentPayload,
  ForwardResponsePayload,
  GetMemoryDocumentPayload,
  GenerateDocumentPayload,
  IPC,
  ImportMemoryDocumentPayload,
  CellFocusedPayload,
  LayoutMode,
  NavigatePayload,
  RemoveMemorySourcePayload,
  SearchMemoryDocumentsPayload,
  SendToAllPayload,
  SetMaximizedCellPayload,
  SetCellUrlPayload,
  SplitRatiosPayload,
  ThemeMode,
  ToggleCellPayload,
} from '../shared/types';
import { MemoryStore } from './memoryStore';
import { WindowManager } from './windowManager';

export function registerIpcHandlers(windowManager: WindowManager, memoryStore: MemoryStore): void {
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

  registerHandler(IPC.GET_DOCUMENT_CANDIDATES, () => {
    return windowManager.getDocumentCandidates();
  });

  registerHandler(IPC.GENERATE_DOCUMENT, (_event, payload: GenerateDocumentPayload) => {
    return windowManager.generateDocument(payload);
  });

  registerHandler(IPC.CHOOSE_MEMORY_DIRECTORY, async () => {
    const window = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      title: 'Choose Memory Inbox Folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return memoryStore.addImportSource(result.filePaths[0]);
  });

  registerHandler(IPC.LIST_MEMORY_SOURCES, () => {
    return memoryStore.listImportSources();
  });

  registerHandler(IPC.REMOVE_MEMORY_SOURCE, (_event, payload: RemoveMemorySourcePayload) => {
    return memoryStore.removeImportSource(payload.id);
  });

  registerHandler(IPC.SCAN_MEMORY_INBOX, () => {
    return memoryStore.scanInbox();
  });

  registerHandler(IPC.GET_MEMORY_INBOX_DOCUMENT, (_event, filePath: string) => {
    return memoryStore.getInboxDocument(filePath);
  });

  registerHandler(IPC.IMPORT_MEMORY_DOCUMENT, (_event, payload: ImportMemoryDocumentPayload) => {
    return memoryStore.importDocument(payload);
  });

  registerHandler(IPC.SEARCH_MEMORY_DOCUMENTS, (_event, payload: SearchMemoryDocumentsPayload) => {
    return memoryStore.searchDocuments(payload.query);
  });

  registerHandler(IPC.GET_MEMORY_DOCUMENT, (_event, payload: GetMemoryDocumentPayload) => {
    return memoryStore.getDocument(payload.id);
  });

  registerHandler(IPC.DISABLE_MEMORY_DOCUMENT, (_event, payload: DisableMemoryDocumentPayload) => {
    return memoryStore.disableDocument(payload.id);
  });

  registerHandler(IPC.SET_THEME_MODE, (_event, mode: ThemeMode) => {
    return windowManager.setThemeMode(mode);
  });

  registerHandler(IPC.SET_LANGUAGE, (_event, language: AppLanguage) => {
    return windowManager.setLanguage(language);
  });

  registerHandler(IPC.SET_FORWARD_CONTROLS_ENABLED, (_event, enabled: boolean) => {
    return windowManager.setForwardControlsEnabled(enabled);
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
