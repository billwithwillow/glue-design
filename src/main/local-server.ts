import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BrowserWindow, ipcMain } from 'electron';
import { v4 as randomUUID } from 'uuid';
import { getCanvasStore } from './ipc-handlers';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { elementTreeToHTML, htmlToElementTree } from '../shared/element-tree';
import type { CanvasComponent } from '../shared/canvas-types';
import { handleMcpRequest } from './mcp-server';
import { captureRenderedPage } from './page-capture';

let server: http.Server | null = null;
let serverPort: number | null = null;

function getPortFilePath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.glue', 'canvas-server.port');
}

async function writePortFile(port: number): Promise<void> {
  const portFile = getPortFilePath();
  await fs.mkdir(path.dirname(portFile), { recursive: true });
  await fs.writeFile(portFile, String(port), 'utf-8');
}

async function removePortFile(): Promise<void> {
  try {
    await fs.unlink(getPortFilePath());
  } catch {
    // Ignore if file doesn't exist
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/** Serialize a CanvasComponent to the external API shape (html/css strings) */
function toExternalShape(comp: CanvasComponent): Record<string, any> {
  return {
    id: comp.id,
    name: comp.name,
    html: elementTreeToHTML(comp.rootElements),
    css: comp.cssRules,
    width: comp.width,
    height: comp.height,
    x: comp.x,
    y: comp.y,
  };
}

export async function startLocalServer(): Promise<number> {
  if (server) {
    return serverPort!;
  }

  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      // MCP endpoint
      if (req.url === '/mcp') {
        try {
          await handleMcpRequest(req, res);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'MCP error' }));
        }
        return;
      }

      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'POST' && req.url === '/canvas/create-component') {
        try {
          const body = JSON.parse(await readBody(req));
          const { name, html, css, width, height } = body;

          if (!name || !html) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'name and html are required' }));
            return;
          }

          const canvasStore = getCanvasStore();
          const component = canvasStore.create({ name, html, css: css || '', width, height });

          const mainWindow = BrowserWindow.getAllWindows()[0];
          if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_CREATED, component);
          }

          res.writeHead(200);
          res.end(JSON.stringify({ success: true, component: toExternalShape(component) }));
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message || 'Internal error' }));
        }
      } else if (req.method === 'POST' && req.url === '/canvas/update-component') {
        try {
          const body = JSON.parse(await readBody(req));
          const { id, html, css, name, width, height } = body;

          if (!id) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'id is required' }));
            return;
          }

          const canvasStore = getCanvasStore();
          const updates: any = {};
          if (html !== undefined) updates.html = html;
          if (css !== undefined) updates.css = css;
          if (name !== undefined) updates.name = name;
          if (width !== undefined) updates.width = width;
          if (height !== undefined) updates.height = height;

          const component = canvasStore.update(id, updates);
          if (!component) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Component not found' }));
            return;
          }

          const mainWindow = BrowserWindow.getAllWindows()[0];
          if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, component);
          }

          res.writeHead(200);
          res.end(JSON.stringify({ success: true, component: toExternalShape(component) }));
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message || 'Internal error' }));
        }
      } else if (req.method === 'GET' && req.url === '/canvas/get-selected') {
        try {
          const mainWindow = BrowserWindow.getAllWindows()[0];
          if (!mainWindow) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'No main window available' }));
            return;
          }

          const requestId = randomUUID();
          mainWindow.webContents.send(IPC_CHANNELS.CANVAS_GET_SELECTED, requestId);

          const timeout = setTimeout(() => {
            ipcMain.removeListener(IPC_CHANNELS.CANVAS_GET_SELECTED_RESULT, handler);
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Timeout waiting for selection' }));
          }, 5000);

          const handler = (_evt: any, data: any) => {
            if (data.requestId === requestId) {
              clearTimeout(timeout);
              ipcMain.removeListener(IPC_CHANNELS.CANVAS_GET_SELECTED_RESULT, handler);
              res.writeHead(200);
              res.end(JSON.stringify({ success: true, component: data.result }));
            }
          };

          ipcMain.on(IPC_CHANNELS.CANVAS_GET_SELECTED_RESULT, handler);
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message || 'Internal error' }));
        }
      } else if (req.method === 'POST' && req.url === '/canvas/insert-html') {
        try {
          const body = JSON.parse(await readBody(req));
          const { id, target_id, html } = body;

          if (!id || !html) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'id and html are required' }));
            return;
          }

          const canvasStore = getCanvasStore();
          const targetHtmlId = target_id ?? null;
          const newNodes = htmlToElementTree(html);
          const component = canvasStore.insertHTMLChildren(id, targetHtmlId, html);
          if (!component) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Component or target element not found' }));
            return;
          }

          const mainWindow = BrowserWindow.getAllWindows()[0];
          if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.CANVAS_ELEMENTS_APPENDED, { componentId: id, targetHtmlId, newNodes });
          }

          res.writeHead(200);
          res.end(JSON.stringify({ success: true, id: component.id, appended: newNodes.length }));
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message || 'Internal error' }));
        }
      } else if (req.method === 'GET' && req.url === '/canvas/list-components') {
        try {
          const canvasStore = getCanvasStore();
          const components = canvasStore.list().map(toExternalShape);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, components }));
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message || 'Internal error' }));
        }
      } else if (req.method === 'POST' && req.url === '/canvas/capture-url') {
        try {
          const body = JSON.parse(await readBody(req));
          const { url, selector, wait_for, wait_ms, name, width, height, viewport_width, viewport_height, source_file, include_screenshot } = body;

          if (!url) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'url is required' }));
            return;
          }

          const result = await captureRenderedPage({
            url,
            selector,
            waitFor: wait_for,
            waitMs: wait_ms,
            viewportWidth: viewport_width,
            viewportHeight: viewport_height,
            includeScreenshot: include_screenshot,
          });

          const canvasStore = getCanvasStore();
          const derivedName = name ?? result.title ?? 'Captured Page';
          const css = [result.css, result.computedStyles].filter(Boolean).join('\n\n');
          const component = canvasStore.create({
            name: derivedName,
            html: result.html,
            css,
            width: width ?? result.viewportWidth,
            height: height ?? result.viewportHeight,
            sourceUrl: url,
            ...(source_file && { sourceFilePath: path.resolve(source_file) }),
          });

          const mainWindow = BrowserWindow.getAllWindows()[0];
          if (mainWindow) {
            mainWindow.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_CREATED, component);
          }

          const responseBody: any = { success: true, component: toExternalShape(component) };
          if (result.screenshot) {
            responseBody.screenshot = result.screenshot;
          }

          res.writeHead(200);
          res.end(JSON.stringify(responseBody));
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message || 'Capture failed' }));
        }
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    srv.listen(4190, '127.0.0.1', async () => {
      const addr = srv.address();
      if (addr && typeof addr !== 'string') {
        serverPort = addr.port;
        server = srv;
        await writePortFile(serverPort);
        console.log(`[Canvas] Server started on port ${serverPort} (MCP available at /mcp)`);
        resolve(serverPort);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    srv.on('error', reject);
  });
}

export async function stopLocalServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    server = null;
    serverPort = null;
    await removePortFile();
  }
}
