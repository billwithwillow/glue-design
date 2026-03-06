import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { setupIpcHandlers } from './ipc-handlers';
import { startLocalServer, stopLocalServer } from './local-server';

async function initialize() {
  app.setName('Glue Canvas');

  await app.whenReady();

  setupIpcHandlers();

  const mainWindow = createMainWindow();

  startLocalServer().catch((err) => {
    console.error('[Canvas] Failed to start local server:', err);
  });

  app.on('before-quit', () => {
    stopLocalServer().catch(() => {});
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

initialize().catch((error) => {
  console.error('Failed to initialize canvas app:', error);
  app.quit();
});
