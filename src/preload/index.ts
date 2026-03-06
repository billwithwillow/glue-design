import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';

export interface CanvasAPI {
  canvas: {
    onComponentCreated: (callback: (component: any) => void) => void;
    onComponentUpdated: (callback: (component: any) => void) => void;
    onElementsAppended: (callback: (data: { componentId: string; targetHtmlId: string | null; newNodes: any[] }) => void) => void;
    deleteComponent: (id: string) => void;
    onComponentDeleted: (callback: (id: string) => void) => void;
    onGetSelected: (callback: (requestId: string) => void) => void;
    respondSelected: (data: { requestId: string; result: any }) => void;
    updatePosition: (id: string, x: number, y: number) => void;
    updatePositions: (updates: { id: string; x: number; y: number }[]) => void;
    updateElement: (componentId: string, elementId: string, updates: {
      styles?: Record<string, string>;
      classes?: string[];
      textContent?: string;
      attributes?: Record<string, string>;
    }) => void;
    nestComponent: (childId: string, parentId: string, insertIndex?: number, targetElementId?: string) => void;
    unnestComponent: (childId: string) => void;
    updateFrameProps: (id: string, frameProps: Record<string, any>) => void;
    resizeComponent: (id: string, width: number, height: number) => void;
    listPages: () => Promise<{ pages: { id: string; name: string }[]; activePageId: string }>;
    createPage: (name: string) => Promise<{ id: string; name: string }>;
    setActivePage: (id: string) => Promise<{ success: boolean }>;
    onPageSwitched: (callback: (data: { pageId: string; components: any[] }) => void) => void;
    exportComponent: (id: string, format: 'react' | 'html') => Promise<{ jsx?: string; html?: string; css?: string; error?: string }>;
    onGetComponentRect: (callback: (data: { requestId: string; componentId: string }) => void) => void;
    respondComponentRect: (data: { requestId: string; rect: { x: number; y: number; width: number; height: number } | null }) => void;
    captureComponent: (id: string) => Promise<{ ok: boolean }>;
  };
  toggleDevTools: () => void;
  getAppInfo: () => Promise<{ version: string; isDev?: boolean }>;
}

contextBridge.exposeInMainWorld('canvasAPI', {
  canvas: {
    onComponentCreated: (callback: (component: any) => void) => {
      ipcRenderer.on(IPC_CHANNELS.CANVAS_COMPONENT_CREATED, (_event, component) => callback(component));
    },
    onComponentUpdated: (callback: (component: any) => void) => {
      ipcRenderer.on(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, (_event, component) => callback(component));
    },
    onElementsAppended: (callback: (data: { componentId: string; targetHtmlId: string | null; newNodes: any[] }) => void) => {
      ipcRenderer.on(IPC_CHANNELS.CANVAS_ELEMENTS_APPENDED, (_event, data) => callback(data));
    },
    deleteComponent: (id: string) => {
      ipcRenderer.send(IPC_CHANNELS.CANVAS_DELETE_COMPONENT, id);
    },
    onComponentDeleted: (callback: (id: string) => void) => {
      ipcRenderer.on(IPC_CHANNELS.CANVAS_COMPONENT_DELETED, (_event, id) => callback(id));
    },
    onGetSelected: (callback: (requestId: string) => void) => {
      ipcRenderer.on(IPC_CHANNELS.CANVAS_GET_SELECTED, (_event, requestId) => callback(requestId));
    },
    respondSelected: (data: { requestId: string; result: any }) => {
      ipcRenderer.send(IPC_CHANNELS.CANVAS_GET_SELECTED_RESULT, data);
    },
    updatePosition: (id: string, x: number, y: number) => {
      ipcRenderer.send(IPC_CHANNELS.CANVAS_UPDATE_POSITION, { id, x, y });
    },
    updatePositions: (updates: { id: string; x: number; y: number }[]) => {
      ipcRenderer.send(IPC_CHANNELS.CANVAS_UPDATE_POSITIONS, updates);
    },
    updateElement: (componentId: string, elementId: string, updates: {
      styles?: Record<string, string>;
      classes?: string[];
      textContent?: string;
      attributes?: Record<string, string>;
    }) => {
      ipcRenderer.send(IPC_CHANNELS.CANVAS_UPDATE_ELEMENT, { componentId, elementId, updates });
    },
    nestComponent: (childId: string, parentId: string, insertIndex?: number, targetElementId?: string) => {
      ipcRenderer.send(IPC_CHANNELS.CANVAS_NEST_COMPONENT, { childId, parentId, insertIndex, targetElementId });
    },
    unnestComponent: (childId: string) => {
      ipcRenderer.send(IPC_CHANNELS.CANVAS_UNNEST_COMPONENT, childId);
    },
    updateFrameProps: (id: string, frameProps: Record<string, any>) => {
      ipcRenderer.send(IPC_CHANNELS.CANVAS_UPDATE_FRAME_PROPS, { id, frameProps });
    },
    resizeComponent: (id: string, width: number, height: number) => {
      ipcRenderer.send(IPC_CHANNELS.CANVAS_RESIZE_COMPONENT, { id, width, height });
    },
    listPages: () => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_LIST_PAGES),
    createPage: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_CREATE_PAGE, name),
    setActivePage: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_SET_ACTIVE_PAGE, id),
    onPageSwitched: (callback: (data: { pageId: string; components: any[] }) => void) => {
      ipcRenderer.on(IPC_CHANNELS.CANVAS_PAGE_SWITCHED, (_event, data) => callback(data));
    },
    exportComponent: (id: string, format: 'react' | 'html') =>
      ipcRenderer.invoke(IPC_CHANNELS.CANVAS_EXPORT_COMPONENT, id, format),
    onGetComponentRect: (callback: (data: { requestId: string; componentId: string }) => void) => {
      ipcRenderer.on(IPC_CHANNELS.CANVAS_GET_COMPONENT_RECT, (_event, data) => callback(data));
    },
    respondComponentRect: (data: { requestId: string; rect: { x: number; y: number; width: number; height: number } | null }) => {
      ipcRenderer.send(IPC_CHANNELS.CANVAS_GET_COMPONENT_RECT_RESULT, data);
    },
    captureComponent: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CANVAS_CAPTURE_COMPONENT, id),
  },
  toggleDevTools: () => ipcRenderer.send(IPC_CHANNELS.TOGGLE_DEVTOOLS),
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_INFO),
} as CanvasAPI);

declare global {
  interface Window {
    canvasAPI: CanvasAPI;
  }
}
