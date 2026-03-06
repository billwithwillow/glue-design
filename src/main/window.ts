import { BrowserWindow } from 'electron';
import * as path from 'path';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f5f5',
    webPreferences: {
      preload: path.join(__dirname, '../../preload/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererPath = path.join(__dirname, '../../renderer/index.html');
  win.loadFile(rendererPath);

  win.on('closed', () => {
    // Window reference cleanup handled by caller
  });

  return win;
}
