# Plan: Codebase Round-Trip Canvas Workflow

## Context
The canvas app has MCP tools for creating and editing components, but no way to pull existing app components onto the canvas. Paper.design's key insight: eliminate format translation on import. Instead of reading JSX source and asking Claude to manually reconstruct it as HTML, we fetch rendered HTML directly from a running dev server — lossless import, no translation. Claude only translates in one direction: canvas → code on write-back.

> Fetch from dev server → inject HTML onto canvas → iterate → read source → write back

---

## Core Changes

### Data Model: extend `CanvasComponent` with source metadata
**File: `src/shared/canvas-types.ts`**

```typescript
export interface CanvasComponent {
  // ... existing fields ...
  frameProps?: FrameProps;
  sourceFilePath?: string;  // absolute path to originating source file (for write-back)
  sourceUrl?: string;       // URL it was fetched from (for context)
}
```

Both are optional and independent. `sourceUrl` is informational; `sourceFilePath` drives the write-back.

---

## New MCP Tools

### 1. `fetch_from_url` (primary import tool)
The key new capability. Fetches rendered HTML from a running dev server and creates a canvas component directly — no JSX-to-HTML translation required.

**Input:**
```
url: string           — full URL, e.g. "http://localhost:3000/components/hero"
selector?: string     — CSS selector to extract, e.g. "#hero", ".hero-section" (default: body first child)
source_file?: string  — optional absolute path to the source file (stored for write-back)
name?: string         — component name (default: derived from URL path)
width?: number
height?: number
```

**Implementation:**
1. `fetch(url)` using Node's built-in fetch (available in Electron/Node 18+)
2. Parse response HTML with `node-html-parser` (already in project)
3. If `selector` provided: extract `root.querySelector(selector).innerHTML`; else use `root.querySelector('body > *')` (first meaningful child of body)
4. Try to inline linked stylesheets: find `<link rel="stylesheet" href="...">` tags, fetch each (same-origin or absolute), collect CSS text
5. `canvasStore.create({ html, css: inlinedCSS, name, width, height, sourceFilePath, sourceUrl: url })`
6. Return `toExternalShape(component)` + a note about any stylesheets that couldn't be fetched

**CSS inlining approach:**
- Find all `<link rel="stylesheet">` in the full page HTML
- Resolve relative hrefs against the base URL
- `fetch()` each stylesheet (best-effort, skip on error)
- Concatenate all CSS into `cssRules` for the component
- This gives reasonable styling without a headless browser

**Error cases:**
- Network error / URL not reachable → `isError: true` with message
- Selector not found → `isError: true` with message
- Partial CSS failure → warn in result but still create component

---

### 2. `read_source_file` (for write-back context)
Claude needs to read the original source before writing back, to understand the code structure and preserve logic/props.

**Input:** `file_path: string` (absolute path)

**Implementation:** `fs.readFileSync(path.resolve(file_path), 'utf8')`

**Returns:** `{ path, size, content }` as JSON text. `isError: true` on failure.

---

### 3. `list_source_files` (discovery)
Help Claude find what source files exist in the project.

**Input:** `project_root: string`, `glob_pattern?: string` (default `**/*.{tsx,jsx,ts,js,vue,svelte}`), `max_results?: number` (default 200)

**Implementation:** Dynamic `import('glob')` with manual `walkDir()` fallback that skips `node_modules`, `.git`, `dist`, `build`, `.next`, `.cache`

**Returns:** `{ project_root, pattern, count, files: string[] }` (relative paths)

---

## Modified Existing Tools

### `create_component` — add source metadata params
Add optional `source_file` and `source_url` params. Store as `sourceFilePath` and `sourceUrl` in the component. Resolve `source_file` to absolute path before storing.

### `write_component` — add `use_source_path` option
- Make `file_path` optional
- Add `use_source_path?: boolean` — if true, write to `comp.sourceFilePath`
- Validate: error if neither `file_path` nor `use_source_path: true`; error if `use_source_path: true` but no `sourceFilePath` stored

### `toExternalShape` — expose new fields
```typescript
...(comp.sourceFilePath !== undefined && { sourceFilePath: comp.sourceFilePath }),
...(comp.sourceUrl !== undefined && { sourceUrl: comp.sourceUrl }),
```

---

## Storage & Undo/Redo

**`src/main/storage/canvas-store.ts`:**
- Update `create()` to accept `sourceFilePath?: string` and `sourceUrl?: string`
- `update()` already uses `Partial<Omit<CanvasComponent, 'id'>>` — auto-handles new fields

**`src/main/ipc-handlers.ts`:**
- Add `sourceFilePath` and `sourceUrl` to both `applyInverse` and `applyForward` update-case restore calls (lines 38-47, 74-83), so undo/redo doesn't drop source associations

---

## The Round-Trip Workflow (for system instructions update)
```
IMPORT (lossless):
1. fetch_from_url(url, selector?, source_file?) → rendered HTML directly onto canvas

ITERATE:
2. insert_html, update_element, etc. — visual iteration

WRITE BACK:
3. read_source_file(source_file)         → Claude reads original source code
4. export_component(id, format='react')  → Claude sees current canvas state as JSX
5. [Claude generates updated source, preserving logic/props/types]
6. write_component(id, use_source_path: true) → writes back to original file
```

---

## Critical Files
- `src/shared/canvas-types.ts` — add 2 optional fields to `CanvasComponent`
- `src/main/storage/canvas-store.ts` — update `create()` signature (~4 lines)
- `src/main/ipc-handlers.ts` — add 2 fields to undo/redo restore (2 call sites)
- `src/main/mcp-server.ts` — `toExternalShape`, `create_component`, `write_component`, + 3 new tools

Total: ~130 lines of new/changed code across 4 files.

---

## Verification
1. `npm run build` in canvas-app — TypeScript must compile clean
2. Start canvas app; start a Next.js/Vite dev server with a component route
3. `fetch_from_url("http://localhost:3000", "#hero")` → component appears on canvas with styling
4. Verify `sourceUrl` and `sourceFilePath` appear in `list_components` output
5. `read_source_file("/path/to/HeroSection.tsx")` → returns file content
6. `write_component(id, use_source_path: true)` → writes to original file
7. Undo a change, verify `sourceFilePath` and `sourceUrl` still present

---

## Extensibility
- **Storybook integration**: `fetch_from_url("http://localhost:6006/iframe.html?story=hero--default")` works out of the box
- **`get_component_diff`**: future tool reading `sourceFilePath`, comparing to current canvas JSX
- **`link_component_to_file`**: future tool to associate existing components with source files
- **Puppeteer/headless upgrade**: replace `fetch()` + CSS inlining with full headless render for perfect fidelity on CSR apps
