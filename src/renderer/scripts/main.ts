import { CanvasEngine } from './canvas-engine';
import { ComponentRenderer } from './component-renderer';
import { LayersSidebar } from './layers-sidebar';
import { MarqueeSelection } from './marquee-selection';
import { OverlayManager } from './overlay-manager';
import { PagesSidebar } from './pages-sidebar';
import { PropertiesSidebar } from './properties-sidebar';
import { SelectionManager } from './selection-manager';

declare global {
  interface Window {
    canvasAPI: any;
  }
}

function isEditingText(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;
}

function init(): void {
  const viewport = document.getElementById('canvas-viewport')!;
  const world = document.getElementById('canvas-world')!;
  const zoomDisplay = document.getElementById('zoom-display')!;
  const zoomInBtn = document.getElementById('zoom-in')!;
  const zoomOutBtn = document.getElementById('zoom-out')!;
  const fitBtn = document.getElementById('fit-all')!;
  const countDisplay = document.getElementById('component-count')!;

  const engine = new CanvasEngine(viewport, world);
  const renderer = new ComponentRenderer(world, engine);
  const overlayManager = new OverlayManager(engine, renderer);
  const sidebar = new PropertiesSidebar();
  const selectionManager = new SelectionManager(viewport, engine, renderer, overlayManager, sidebar);
  new MarqueeSelection(viewport, engine, renderer, selectionManager);
  const pagesSidebar = new PagesSidebar();
  const layersSidebar = new LayersSidebar(renderer, selectionManager);

  // Update zoom display
  engine.onStateChange((state) => {
    zoomDisplay.textContent = `${Math.round(state.zoom * 100)}%`;
  });

  // Zoom controls
  zoomInBtn.addEventListener('click', () => {
    const { zoom } = engine.getState();
    engine.setZoom(zoom * 1.25);
  });

  zoomOutBtn.addEventListener('click', () => {
    const { zoom } = engine.getState();
    engine.setZoom(zoom / 1.25);
  });

  fitBtn.addEventListener('click', () => {
    engine.fitAll(renderer.getAllBounds());
  });

  // Component count
  renderer.onCountChange((count) => {
    countDisplay.textContent = `${count} component${count !== 1 ? 's' : ''}`;
  });

  // Page switching
  window.canvasAPI?.canvas.onPageSwitched((data: { pageId: string; components: any[] }) => {
    renderer.select(null);
    sidebar.hide();
    layersSidebar.clear();
    renderer.clearAll();
    for (const component of data.components) {
      renderer.addComponent(component);
    }
    pagesSidebar.render();
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    // Backspace / Delete → delete selected components (only in component mode, not element mode)
    if ((e.key === 'Backspace' || e.key === 'Delete') && !isEditingText(e) && !selectionManager.isInElementMode()) {
      e.preventDefault();
      renderer.deleteSelected();
    }
    // Cmd+Z → undo, Cmd+Shift+Z → redo
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      window.canvasAPI?.canvas.undo();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      window.canvasAPI?.canvas.redo();
    }
    // Cmd+Shift+I → toggle dev tools
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'I') {
      window.canvasAPI?.toggleDevTools();
    }
    // Cmd+0 → reset zoom
    if ((e.metaKey || e.ctrlKey) && e.key === '0') {
      e.preventDefault();
      engine.setZoom(1);
    }
    // Cmd+= → zoom in
    if ((e.metaKey || e.ctrlKey) && e.key === '=') {
      e.preventDefault();
      engine.setZoom(engine.getState().zoom * 1.25);
    }
    // Cmd+- → zoom out
    if ((e.metaKey || e.ctrlKey) && e.key === '-') {
      e.preventDefault();
      engine.setZoom(engine.getState().zoom / 1.25);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
