import { ipcMain, app, BrowserWindow, clipboard } from 'electron';
import { v4 as randomUUID } from 'uuid';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { CanvasStore } from './storage/canvas-store';
import { componentToReact } from '../shared/export-utils';
import { elementTreeToHTML } from '../shared/element-tree';

let canvasStore: CanvasStore;

export function getCanvasStore(): CanvasStore {
  return canvasStore;
}

export function getComponentRect(id: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) { resolve(null); return; }

    const requestId = randomUUID();
    win.webContents.send(IPC_CHANNELS.CANVAS_GET_COMPONENT_RECT, { requestId, componentId: id });

    const timeout = setTimeout(() => {
      ipcMain.removeListener(IPC_CHANNELS.CANVAS_GET_COMPONENT_RECT_RESULT, handler);
      resolve(null);
    }, 5000);

    const handler = (_evt: any, data: any) => {
      if (data.requestId === requestId) {
        clearTimeout(timeout);
        ipcMain.removeListener(IPC_CHANNELS.CANVAS_GET_COMPONENT_RECT_RESULT, handler);
        resolve(data.rect ?? null);
      }
    };

    ipcMain.on(IPC_CHANNELS.CANVAS_GET_COMPONENT_RECT_RESULT, handler);
  });
}

export function setupIpcHandlers(): void {
  canvasStore = new CanvasStore();

  // Canvas: update single component position when user drags
  ipcMain.on(IPC_CHANNELS.CANVAS_UPDATE_POSITION, (_event, data: { id: string; x: number; y: number }) => {
    canvasStore.update(data.id, { x: data.x, y: data.y });
  });

  // Canvas: batch position update (multi-drag)
  ipcMain.on(IPC_CHANNELS.CANVAS_UPDATE_POSITIONS, (_event, updates: { id: string; x: number; y: number }[]) => {
    canvasStore.updatePositions(updates);
  });

  // Canvas: update individual element within a component
  ipcMain.on(IPC_CHANNELS.CANVAS_UPDATE_ELEMENT, (_event, data: {
    componentId: string;
    elementId: string;
    updates: { styles?: Record<string, string>; classes?: string[]; textContent?: string; attributes?: Record<string, string> };
  }) => {
    const component = canvasStore.updateElement(data.componentId, data.elementId, data.updates);
    if (component) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, component);
      }
    }
  });

  // Canvas: resize frame (component mode)
  ipcMain.on(IPC_CHANNELS.CANVAS_RESIZE_COMPONENT, (_event, data: { id: string; width: number; height: number }) => {
    const component = canvasStore.update(data.id, { width: data.width, height: data.height });
    if (component) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, component);
      }
    }
  });

  // Canvas: nest component
  ipcMain.on(IPC_CHANNELS.CANVAS_NEST_COMPONENT, (_event, data: { childId: string; parentId: string; insertIndex?: number; targetElementId?: string }) => {
    const result = canvasStore.nestComponent(data.childId, data.parentId, data.insertIndex, data.targetElementId);
    if (result) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, result.parent);
        win.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, result.child);
      }
    }
  });

  // Canvas: unnest component
  ipcMain.on(IPC_CHANNELS.CANVAS_UNNEST_COMPONENT, (_event, childId: string) => {
    const result = canvasStore.unnestComponent(childId);
    if (result) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, result.parent);
        win.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, result.child);
      }
    }
  });

  // Canvas: delete component
  ipcMain.on(IPC_CHANNELS.CANVAS_DELETE_COMPONENT, (_event, id: string) => {
    canvasStore.delete(id);
  });

  // Canvas: delete individual element within a component
  ipcMain.on(IPC_CHANNELS.CANVAS_DELETE_ELEMENT, (_event, data: { componentId: string; elementId: string }) => {
    const component = canvasStore.deleteElement(data.componentId, data.elementId);
    if (component) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, component);
      }
    }
  });

  // Page management
  ipcMain.handle(IPC_CHANNELS.CANVAS_LIST_PAGES, () => {
    return {
      pages: canvasStore.listPages(),
      activePageId: canvasStore.getActivePage().id,
    };
  });

  ipcMain.handle(IPC_CHANNELS.CANVAS_CREATE_PAGE, (_event, name: string) => {
    return canvasStore.createPage(name);
  });

  ipcMain.handle(IPC_CHANNELS.CANVAS_SET_ACTIVE_PAGE, (_event, id: string) => {
    const success = canvasStore.setActivePage(id);
    if (success) {
      const components = canvasStore.list();
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.webContents.send(IPC_CHANNELS.CANVAS_PAGE_SWITCHED, {
          pageId: id,
          components,
        });
      }
      return { success: true };
    }
    return { success: false };
  });

  // Capture component screenshot → clipboard
  ipcMain.handle(IPC_CHANNELS.CANVAS_CAPTURE_COMPONENT, async (_event, id: string) => {
    const rect = await getComponentRect(id);
    if (!rect) return { ok: false };
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return { ok: false };
    const image = await win.webContents.capturePage(rect);
    clipboard.writeImage(image);
    return { ok: true };
  });

  // Export component
  ipcMain.handle(IPC_CHANNELS.CANVAS_EXPORT_COMPONENT, (_event, id: string, format: 'react' | 'html') => {
    const comp = canvasStore.get(id);
    if (!comp) return { error: `Component ${id} not found` };
    if (format === 'react') {
      const allComps = canvasStore.list();
      const componentMap: Record<string, { name: string }> = {};
      for (const c of allComps) componentMap[c.id] = { name: c.name };
      const { jsx, css } = componentToReact(comp, componentMap);
      return { jsx, css };
    } else {
      const html = elementTreeToHTML(comp.rootElements);
      const css = comp.cssRules;
      return { html, css };
    }
  });

  // DevTools toggle
  ipcMain.on(IPC_CHANNELS.TOGGLE_DEVTOOLS, () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools();
      }
    }
  });

  // App info
  ipcMain.handle(IPC_CHANNELS.GET_APP_INFO, () => {
    return {
      version: app.getVersion(),
      isDev: process.env.GLUE_DEV === '1',
    };
  });
}
