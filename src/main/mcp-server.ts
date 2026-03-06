import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { IncomingMessage, ServerResponse } from 'http';
import { BrowserWindow, ipcMain } from 'electron';
import { v4 as randomUUID } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { getCanvasStore, getComponentRect } from './ipc-handlers';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { elementTreeToHTML, htmlToElementTree } from '../shared/element-tree';
import type { CanvasComponent } from '../shared/canvas-types';
import { componentToReact } from '../shared/export-utils';
import { z } from 'zod';

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null;
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
    ...(comp.frameProps !== undefined && { frameProps: comp.frameProps }),
  };
}

/** Build a FrameProps object from flat MCP args (snake_case → camelCase) */
function buildFrameProps(args: { fill?: string; shadow?: string; corner_radius?: number; border?: string; clip_content?: boolean }): import('../shared/canvas-types').FrameProps | undefined {
  if (args.fill === undefined && args.shadow === undefined && args.corner_radius === undefined && args.border === undefined && args.clip_content === undefined) {
    return undefined;
  }
  return {
    ...(args.fill !== undefined && { fill: args.fill }),
    ...(args.shadow !== undefined && { shadow: args.shadow }),
    ...(args.corner_radius !== undefined && { cornerRadius: args.corner_radius }),
    ...(args.border !== undefined && { border: args.border }),
    ...(args.clip_content !== undefined && { clipContent: args.clip_content }),
  };
}

function getSelectedComponent(): Promise<any> {
  return new Promise((resolve) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      resolve(null);
      return;
    }

    const requestId = randomUUID();
    mainWindow.webContents.send(IPC_CHANNELS.CANVAS_GET_SELECTED, requestId);

    const timeout = setTimeout(() => {
      ipcMain.removeListener(IPC_CHANNELS.CANVAS_GET_SELECTED_RESULT, handler);
      resolve(null);
    }, 5000);

    const handler = (_evt: any, data: any) => {
      if (data.requestId === requestId) {
        clearTimeout(timeout);
        ipcMain.removeListener(IPC_CHANNELS.CANVAS_GET_SELECTED_RESULT, handler);
        resolve(data.result ?? null);
      }
    };

    ipcMain.on(IPC_CHANNELS.CANVAS_GET_SELECTED_RESULT, handler);
  });
}

function registerTools(mcpServer: McpServer): void {
  // Cast to any to avoid MCP SDK deep type instantiation blowing up the TS compiler
  const server = mcpServer as any;
  server.tool(
    'create_component',
    'Create a component on the Glue canvas. Intended for the container skeleton — give your root element an id (e.g. <div id="card" style="...">) then use insert_html to add content incrementally. Returns the component with its assigned ID and position.',
    {
      name: z.string().describe('Display name for the component (like a Figma artboard label)'),
      html: z.string().describe('HTML markup for the component body'),
      css: z.string().optional().describe('CSS styles for the component'),
      width: z.number().optional().describe('Width in pixels (default: 400)'),
      height: z.number().optional().describe('Height in pixels (default: 300)'),
      fill: z.string().optional().describe('CSS background for the frame (e.g. "white", "#1a1060", "linear-gradient(...)")'),
      shadow: z.string().optional().describe('CSS box-shadow for the frame. Use empty string "" or "none" for no shadow.'),
      corner_radius: z.number().optional().describe('Corner radius in px (default: 12)'),
      border: z.string().optional().describe('CSS border shorthand (default: "1.5px solid #e5e5e5"). Use "none" to remove.'),
      clip_content: z.boolean().optional().describe('Clip children to frame bounds (default: true)'),
    },
    async (args: any) => {
      const canvasStore = getCanvasStore();
      const component = canvasStore.create({
        name: args.name,
        html: args.html,
        css: args.css || '',
        width: args.width,
        height: args.height,
        frameProps: buildFrameProps(args),
      });

      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_CREATED, component);
      }

      return { content: [{ type: 'text', text: JSON.stringify(toExternalShape(component), null, 2) }] };
    }
  );

  server.tool(
    'update_component',
    'Update an existing component on the Glue canvas. Only provided fields are changed.',
    {
      id: z.string().describe('Component ID to update'),
      html: z.string().optional().describe('New HTML markup'),
      css: z.string().optional().describe('New CSS styles'),
      name: z.string().optional().describe('New display name'),
      width: z.number().optional().describe('New width in pixels'),
      height: z.number().optional().describe('New height in pixels'),
      fill: z.string().optional().describe('CSS background for the frame (e.g. "white", "#1a1060", "linear-gradient(...)")'),
      shadow: z.string().optional().describe('CSS box-shadow for the frame. Use empty string "" or "none" for no shadow.'),
      corner_radius: z.number().optional().describe('Corner radius in px (default: 12)'),
      border: z.string().optional().describe('CSS border shorthand (default: "1.5px solid #e5e5e5"). Use "none" to remove.'),
      clip_content: z.boolean().optional().describe('Clip children to frame bounds (default: true)'),
    },
    async (args: any) => {
      const canvasStore = getCanvasStore();
      const { id, fill, shadow, corner_radius, border, clip_content, ...rest } = args;
      const filtered: Record<string, any> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) filtered[k] = v;
      }
      const frameProps = buildFrameProps({ fill, shadow, corner_radius, border, clip_content });
      if (frameProps !== undefined) filtered.frameProps = frameProps;

      const component = canvasStore.update(id, filtered);
      if (!component) {
        return { content: [{ type: 'text', text: `Error: Component ${id} not found` }], isError: true };
      }

      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, component);
      }

      return { content: [{ type: 'text', text: JSON.stringify(toExternalShape(component), null, 2) }] };
    }
  );

  server.tool(
    'get_selected_component',
    'Get the currently selected component on the Glue canvas. Returns null if nothing is selected.',
    {},
    async () => {
      const component = await getSelectedComponent();
      if (!component) {
        return { content: [{ type: 'text', text: 'No component is currently selected.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(component, null, 2) }] };
    }
  );

  server.tool(
    'list_components',
    'List all components currently on the Glue canvas.',
    {},
    async () => {
      const canvasStore = getCanvasStore();
      const components = canvasStore.list().map(toExternalShape);
      if (components.length === 0) {
        return { content: [{ type: 'text', text: 'No components on the canvas.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(components, null, 2) }] };
    }
  );

  server.tool(
    'update_element',
    'Update a specific element within a component. Allows surgical edits to individual elements without replacing the whole component HTML.',
    {
      component_id: z.string().describe('ID of the component containing the element'),
      element_id: z.string().describe('ID of the element to update (from data-element-id)'),
      styles: z.record(z.string()).optional().describe('CSS styles to set (empty string value removes a property)'),
      text_content: z.string().optional().describe('New text content for the element'),
      classes: z.array(z.string()).optional().describe('Replace element classes with this list'),
      attributes: z.record(z.string()).optional().describe('Attributes to set (empty string value removes an attribute)'),
    },
    async (args: any) => {
      const canvasStore = getCanvasStore();

      const updates: Record<string, any> = {};
      if (args.styles) updates.styles = args.styles;
      if (args.text_content !== undefined) updates.textContent = args.text_content;
      if (args.classes) updates.classes = args.classes;
      if (args.attributes) updates.attributes = args.attributes;

      const component = canvasStore.updateElement(args.component_id, args.element_id, updates);
      if (!component) {
        return { content: [{ type: 'text', text: `Error: Component ${args.component_id} or element ${args.element_id} not found` }], isError: true };
      }

      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, component);
      }

      return { content: [{ type: 'text', text: JSON.stringify(toExternalShape(component), null, 2) }] };
    }
  );

  server.tool(
    'insert_html',
    `Append HTML as new children to an element inside a component. Use this to build content
progressively — add one visual group per call so changes render live on canvas:
- First call create_component with a container element that has an id (e.g. <div id="card" ...>)
- Then call insert_html repeatedly: one header, one row, one section at a time
- Keep each call to a single visual group (~5-15 lines of HTML)
If target_id is omitted, HTML is appended to the component root.

Use mode="replace_children" to fix a wrong subtree without rebuilding the whole component — it replaces all existing children of the target element with the new HTML.`,
    {
      component_id: z.string().describe('ID of the component to append into'),
      target_id: z.string().optional().describe('HTML id attribute of the target element (e.g. "card"). Omit to append to root.'),
      html: z.string().describe('HTML fragment to append as new children'),
      mode: z.enum(['append', 'replace_children']).optional().describe('"append" (default) adds new children; "replace_children" replaces all existing children with the new HTML'),
    },
    async (args: any) => {
      const canvasStore = getCanvasStore();
      const targetHtmlId = args.target_id ?? null;
      const mode = args.mode ?? 'append';

      if (mode === 'replace_children') {
        const component = canvasStore.replaceElementChildren(args.component_id, targetHtmlId, args.html);
        if (!component) {
          return { content: [{ type: 'text', text: 'Error: component or element not found' }], isError: true };
        }
        const win = getMainWindow();
        if (win) {
          win.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, component);
        }
        return { content: [{ type: 'text', text: JSON.stringify({ id: component.id, name: component.name, width: component.width, height: component.height, replaced: true }) }] };
      }

      // mode === 'append'
      // Parse the new fragment before inserting so we can send just the delta
      const newNodes = htmlToElementTree(args.html);
      const component = canvasStore.insertHTMLChildren(args.component_id, targetHtmlId, args.html);
      if (!component) {
        return { content: [{ type: 'text', text: 'Error: component or element not found' }], isError: true };
      }
      const win = getMainWindow();
      if (win) {
        // Send only the new nodes (delta), not the full component
        win.webContents.send(IPC_CHANNELS.CANVAS_ELEMENTS_APPENDED, { componentId: args.component_id, targetHtmlId, newNodes });
      }
      // Return lean response — Claude doesn't need the full growing HTML back
      return { content: [{ type: 'text', text: JSON.stringify({ id: component.id, name: component.name, width: component.width, height: component.height, appended: newNodes.length }) }] };
    }
  );

  server.tool(
    'delete_element',
    'Delete a specific element within a component by its internal element ID (el-N format, visible in the HTML returned by list_components). Removes the element and all its children without affecting siblings.',
    {
      component_id: z.string().describe('ID of the component containing the element'),
      element_id: z.string().describe('Internal element ID (el-N format) of the element to delete'),
    },
    async (args: any) => {
      const canvasStore = getCanvasStore();
      const component = canvasStore.deleteElement(args.component_id, args.element_id);
      if (!component) {
        return { content: [{ type: 'text', text: `Error: Component ${args.component_id} or element ${args.element_id} not found` }], isError: true };
      }
      const win = getMainWindow();
      if (win) {
        win.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_UPDATED, component);
      }
      return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, element_id: args.element_id, component_id: args.component_id }) }] };
    }
  );

  server.tool(
    'delete_component',
    'Delete a component from the Glue canvas by ID.',
    {
      id: z.string().describe('Component ID to delete'),
    },
    async (args: any) => {
      const canvasStore = getCanvasStore();
      const deleted = canvasStore.delete(args.id);
      if (!deleted) {
        return { content: [{ type: 'text', text: `Error: Component ${args.id} not found` }], isError: true };
      }
      const win = getMainWindow();
      if (win) win.webContents.send(IPC_CHANNELS.CANVAS_COMPONENT_DELETED, args.id);
      return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, id: args.id }) }] };
    }
  );

  // ── Screenshot tool ──

  server.tool(
    'get_screenshot',
    'Get a screenshot of a component as a base64 image. Use this alongside get_jsx or export_component to get a visual reference when implementing a design.',
    {
      id: z.string().describe('Component ID to screenshot'),
    },
    async (args: any) => {
      const rect = await getComponentRect(args.id);
      if (!rect) {
        return { content: [{ type: 'text', text: `Error: Component ${args.id} not found or not visible on screen` }], isError: true };
      }
      const mainWindow = getMainWindow();
      if (!mainWindow) {
        return { content: [{ type: 'text', text: 'Error: No window available' }], isError: true };
      }
      const image = await mainWindow.webContents.capturePage(rect);
      const base64 = image.toPNG().toString('base64');
      return {
        content: [{ type: 'image', data: base64, mimeType: 'image/png' }],
      };
    }
  );

  // ── Export tool ──

  server.tool(
    'export_component',
    'Export a component as React JSX or plain HTML. Returns a screenshot of the component followed by the formatted code — use the screenshot as the visual spec when adapting the component to your codebase.',
    {
      id: z.string().describe('Component ID to export'),
      format: z.enum(['react', 'html']).describe('"react" returns a JSX functional component with camelCase styles; "html" returns plain HTML with a <style> block'),
    },
    async (args: any) => {
      const canvasStore = getCanvasStore();
      const comp = canvasStore.get(args.id);
      if (!comp) {
        return { content: [{ type: 'text', text: `Error: Component ${args.id} not found` }], isError: true };
      }

      let code: string;
      if (args.format === 'react') {
        const { jsx, css } = componentToReact(comp);
        code = css.trim() ? `${jsx}\n\n/* CSS */\n${css}` : jsx;
      } else {
        const html = elementTreeToHTML(comp.rootElements);
        const css = comp.cssRules.trim();
        code = css ? `<style>\n${css}\n</style>\n\n${html}` : html;
      }

      const contentBlocks: any[] = [];

      // Attempt screenshot — goes first so agent sees visual spec before code
      try {
        const rect = await getComponentRect(args.id);
        if (rect) {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            const image = await mainWindow.webContents.capturePage(rect);
            contentBlocks.push({ type: 'image', data: image.toPNG().toString('base64'), mimeType: 'image/png' });
          }
        }
      } catch {
        // Screenshot is optional — never fail export
      }

      contentBlocks.push({ type: 'text', text: code });
      return { content: contentBlocks };
    }
  );

  // ── Write component to file ──

  server.tool(
    'write_component',
    'Export a component and write it to a file on disk. Use this to drop a canvas component directly into your codebase. Pass include_screenshot: true to also write a companion PNG at the same path.',
    {
      id: z.string().describe('Component ID to export'),
      file_path: z.string().describe('Absolute or relative file path to write (e.g. "/path/to/MyCard.tsx" or "./src/components/MyCard.tsx")'),
      format: z.enum(['react', 'html']).optional().describe('"react" (default) writes a JSX .tsx file; "html" writes a standalone HTML file'),
      include_screenshot: z.boolean().optional().describe('When true, also writes a companion <same-basename>.png screenshot next to the code file'),
    },
    async (args: any) => {
      const canvasStore = getCanvasStore();
      const comp = canvasStore.get(args.id);
      if (!comp) {
        return { content: [{ type: 'text', text: `Error: Component ${args.id} not found` }], isError: true };
      }

      const format = args.format ?? 'react';
      let code: string;

      if (format === 'react') {
        const { jsx, css } = componentToReact(comp);
        code = css.trim() ? `${jsx}\n\n/* CSS */\n${css}` : jsx;
      } else {
        const html = elementTreeToHTML(comp.rootElements);
        const css = comp.cssRules.trim();
        code = css ? `<style>\n${css}\n</style>\n\n${html}` : html;
      }

      const resolvedPath = path.resolve(args.file_path);
      try {
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        fs.writeFileSync(resolvedPath, code, 'utf8');
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error writing file: ${err.message}` }], isError: true };
      }

      const result: Record<string, any> = { written: true, path: resolvedPath, format, bytes: Buffer.byteLength(code, 'utf8') };

      if (args.include_screenshot) {
        const screenshotPath = path.join(path.dirname(resolvedPath), `${path.basename(resolvedPath, path.extname(resolvedPath))}.png`);
        try {
          const rect = await getComponentRect(args.id);
          if (rect) {
            const mainWindow = getMainWindow();
            if (mainWindow) {
              const image = await mainWindow.webContents.capturePage(rect);
              fs.writeFileSync(screenshotPath, image.toPNG());
              result.screenshot = screenshotPath;
            } else {
              result.screenshotWarning = 'No window available for screenshot';
            }
          } else {
            result.screenshotWarning = 'Component not visible on screen';
          }
        } catch (err: any) {
          result.screenshotWarning = `Screenshot failed: ${err.message}`;
        }
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── Project context tool ──

  server.tool(
    'get_project_context',
    'Detect framework, component library, Tailwind usage, existing components, and import aliases from a project root. Call this once before adapting an exported component to your codebase.',
    {
      project_root: z.string().describe('Absolute path to the project root (directory containing package.json)'),
    },
    async (args: any) => {
      const root = path.resolve(args.project_root);

      // Read package.json
      let deps: Record<string, string> = {};
      let devDeps: Record<string, string> = {};
      try {
        const pkgRaw = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
        const pkg = JSON.parse(pkgRaw);
        deps = pkg.dependencies ?? {};
        devDeps = pkg.devDependencies ?? {};
      } catch {
        return { content: [{ type: 'text', text: `Error: Could not read package.json at ${root}` }], isError: true };
      }

      const allDeps = { ...deps, ...devDeps };
      const depNames = Object.keys(allDeps);

      // Detect framework
      let framework: string = 'unknown';
      if ('next' in allDeps) framework = 'next';
      else if ('vite' in devDeps || 'vite' in deps) framework = 'vite';
      else if ('react' in allDeps) framework = 'react';

      // Detect Tailwind
      const hasTailwind = 'tailwindcss' in allDeps;

      // Detect component library
      let componentLibrary: string | null = null;
      if ('@mui/material' in allDeps) componentLibrary = 'mui';
      else if ('@chakra-ui/react' in allDeps) componentLibrary = 'chakra';
      else if ('@radix-ui/react-dialog' in allDeps || Object.keys(allDeps).some(k => k.startsWith('@radix-ui/'))) {
        // shadcn uses radix-ui under the hood; check for shadcn marker
        const hasShadcn = 'shadcn' in allDeps || 'shadcn-ui' in allDeps || fs.existsSync(path.join(root, 'components.json'));
        componentLibrary = hasShadcn ? 'shadcn' : 'radix';
      }

      // Scan for existing components
      let existingComponents: string[] = [];
      const componentDirs = [
        path.join(root, 'src', 'components'),
        path.join(root, 'components'),
        path.join(root, 'src', 'ui'),
      ];
      for (const dir of componentDirs) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          existingComponents = entries
            .filter(e => e.isFile() && /\.(tsx|jsx)$/.test(e.name))
            .map(e => path.basename(e.name, path.extname(e.name)));
          if (existingComponents.length > 0) break;
        } catch {
          // Dir doesn't exist, try next
        }
      }

      // Read tsconfig paths for import alias
      let importAlias: string | null = null;
      const tsconfigPaths = [
        path.join(root, 'tsconfig.json'),
        path.join(root, 'tsconfig.app.json'),
      ];
      for (const tsconfigPath of tsconfigPaths) {
        try {
          const raw = fs.readFileSync(tsconfigPath, 'utf8');
          // Strip JSON comments before parsing
          const cleaned = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
          const tsconfig = JSON.parse(cleaned);
          const paths = tsconfig?.compilerOptions?.paths ?? {};
          const firstAlias = Object.keys(paths)[0];
          if (firstAlias) {
            importAlias = firstAlias.replace(/\*$/, '');
            break;
          }
        } catch {
          // tsconfig not found or invalid, continue
        }
      }

      const result = {
        framework,
        hasTailwind,
        componentLibrary,
        existingComponents,
        importAlias,
        rawDependencies: depNames,
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── Page management tools ──

  server.tool(
    'list_pages',
    'List all pages in the canvas project.',
    {},
    async () => {
      const canvasStore = getCanvasStore();
      const pages = canvasStore.listPages();
      return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
    }
  );

  server.tool(
    'create_page',
    'Create a new page in the canvas project.',
    {
      name: z.string().describe('Name for the new page'),
    },
    async (args: any) => {
      const canvasStore = getCanvasStore();
      const page = canvasStore.createPage(args.name);
      return { content: [{ type: 'text', text: JSON.stringify({ id: page.id, name: page.name }, null, 2) }] };
    }
  );

  server.tool(
    'switch_page',
    'Switch to a different page by ID.',
    {
      page_id: z.string().describe('Page ID to switch to'),
    },
    async (args: any) => {
      const canvasStore = getCanvasStore();
      const success = canvasStore.setActivePage(args.page_id);
      if (!success) {
        return { content: [{ type: 'text', text: `Error: Page ${args.page_id} not found` }], isError: true };
      }
      return { content: [{ type: 'text', text: `Switched to page ${args.page_id}` }] };
    }
  );
}

export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = new McpServer(
    { name: 'glue-canvas', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions: `You are building UI components on the Glue canvas. The user watches your work render live in real-time after every tool call.

## IMPORTANT: Build incrementally, never all at once

- NEVER write an entire component in a single create_component call.
- Always start with create_component containing just an empty container element with an id.
- Then use insert_html to add content one visual group at a time: one header, one row, one section per call.
- Keep each insert_html call to a single visual group (~5–15 lines of HTML).
- The user sees each piece appear as you call the tool — this is the intended experience.

## Workflow

1. create_component(name="...", html='<div id="root" style="...">')  → empty container appears
2. insert_html(component_id, target_id="root", html='<header>...</header>')  → header appears
3. insert_html(component_id, target_id="root", html='<section>...</section>')  → section appears
4. ...continue until complete

## CRITICAL: Horizontal layouts (flex rows, columns, grids)

insert_html always appends children to the target element. It cannot keep a container "open" across calls.

**BROKEN — never do this:**
\`\`\`
// Call A: creates the flex row AND the first card, then closes the row
insert_html → '<div id="row" style="display:flex"><div>Card 1</div></div>'
// Call B: Card 2 lands as a SIBLING of #row, not inside it — flex has no effect
insert_html → '<div>Card 2</div>'
\`\`\`

**CORRECT — container-first pattern:**
\`\`\`
// 1. Pre-declare ALL layout containers in create_component with unique ids
create_component(html='<div id="root"><div id="header"></div><div id="cards" style="display:flex; gap:16px;"></div></div>')
// 2. Target each container by id when inserting content
insert_html(target_id="header")  → header content lands inside #header
insert_html(target_id="cards")   → Card 1 lands inside #cards as a flex child
insert_html(target_id="cards")   → Card 2 lands inside #cards as a flex child
insert_html(target_id="cards")   → Card 3 lands inside #cards as a flex child
\`\`\`

Any time you need flex siblings (cards side by side, columns, icon rows), pre-create a named wrapper container in create_component and use target_id to inject each child.

## Sizing

- The canvas is a fixed-size artboard — content that overflows a clipped frame is invisible.
- Always pass \`clip_content: false\` on create_component so nothing is hidden while building.
- Estimate height generously (add 10–15% buffer).
- After all content is inserted, call update_component with the final fitted height and \`clip_content: true\`.

## Styling

- Use inline styles on all elements (style="...").
- All Google Fonts are available by family name.
- Use display: flex as the primary layout mode. Avoid display: grid or display: inline.
- Use px units for font sizes.

## Frame-level properties

Use frame props on create_component/update_component for frame-level effects — these render at the Glue frame boundary, not inside the HTML content:
- \`fill\`: background color/gradient of the component (e.g. "linear-gradient(135deg, #0d1b4b, #5c1a8a)")
- \`shadow\`: CSS box-shadow at the frame level — use this instead of box-shadow on inner elements to avoid bleed (e.g. "0 24px 60px rgba(0,0,0,0.45)"). Use "" for no shadow.
- \`corner_radius\`: corner radius in px (default 12)
- \`border\`: CSS border shorthand (default "1.5px solid #e5e5e5"); use "none" to remove
- \`clip_content\`: whether to clip children to the frame (default true)

## Fixing mistakes surgically

- **Wrong children in a container?** Use \`insert_html\` with \`mode: "replace_children"\` to swap out a subtree without rebuilding the whole component.
- **Orphaned or wrong element?** Use \`delete_element\` with the internal \`el-N\` id (visible in HTML returned by \`list_components\`) to remove it without affecting siblings.`
    }
  );
  registerTools(server);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
