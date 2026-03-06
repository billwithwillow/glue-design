import { CanvasEngine } from './canvas-engine';
import { ComponentRenderer } from './component-renderer';

const HANDLE_DIRECTIONS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type HandleDirection = typeof HANDLE_DIRECTIONS[number];

const HANDLE_CURSORS: Record<HandleDirection, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

export class OverlayManager {
  private engine: CanvasEngine;
  private renderer: ComponentRenderer;
  private overlayLayer: HTMLElement;

  private hoverOverlay: HTMLElement;
  private selectionOverlays: HTMLElement[] = [];
  private resizeHandles: Map<HandleDirection, HTMLElement> = new Map();

  // Resize state
  private resizing: {
    direction: HandleDirection;
    componentId: string;
    elementId: string | null;  // null = resizing the frame itself
    startRect: { x: number; y: number; width: number; height: number };
    startPointer: { x: number; y: number };
    domElement: HTMLElement;
  } | null = null;

  private currentZoom = 1;

  constructor(engine: CanvasEngine, renderer: ComponentRenderer) {
    this.engine = engine;
    this.renderer = renderer;

    // Create overlay layer
    this.overlayLayer = document.createElement('div');
    this.overlayLayer.id = 'selection-overlay-layer';
    const viewport = document.getElementById('canvas-viewport')!;
    viewport.appendChild(this.overlayLayer);

    // Create hover overlay
    this.hoverOverlay = document.createElement('div');
    this.hoverOverlay.className = 'element-hover-overlay';
    this.hoverOverlay.style.display = 'none';
    this.overlayLayer.appendChild(this.hoverOverlay);

    // Create resize handles
    for (const dir of HANDLE_DIRECTIONS) {
      const handle = document.createElement('div');
      handle.className = `resize-handle resize-${dir}`;
      handle.style.display = 'none';
      handle.style.cursor = HANDLE_CURSORS[dir];
      handle.addEventListener('pointerdown', (e) => this.onResizeStart(e, dir));
      this.overlayLayer.appendChild(handle);
      this.resizeHandles.set(dir, handle);
    }

    // Sync transform with canvas world
    engine.onStateChange((state) => {
      this.currentZoom = state.zoom;
      this.overlayLayer.style.transform = `matrix(${state.zoom}, 0, 0, ${state.zoom}, ${state.panX}, ${state.panY})`;
      this.updateZoomDependentSizes();
    });

    // Initialize transform
    const state = engine.getState();
    this.currentZoom = state.zoom;
    this.overlayLayer.style.transform = `matrix(${state.zoom}, 0, 0, ${state.zoom}, ${state.panX}, ${state.panY})`;

    // Resize event handlers
    window.addEventListener('pointermove', this.onResizeMove);
    window.addEventListener('pointerup', this.onResizeEnd);
  }

  showSelection(componentId: string, elementIds: Set<string>): void {
    // Clear existing selection overlays
    for (const overlay of this.selectionOverlays) {
      overlay.remove();
    }
    this.selectionOverlays = [];

    const comp = this.renderer.getRenderedComponent(componentId);
    if (!comp) return;

    let singleElementId: string | null = null;
    if (elementIds.size === 1) {
      singleElementId = elementIds.values().next().value!;
    }

    for (const elementId of elementIds) {
      const domEl = comp.shadow.querySelector(`[data-element-id="${elementId}"]`) as HTMLElement;
      if (!domEl) continue;

      const overlay = document.createElement('div');
      overlay.className = 'element-selection-overlay';
      this.positionOverlay(overlay, domEl);
      this.overlayLayer.appendChild(overlay);
      this.selectionOverlays.push(overlay);
    }

    // Show resize handles only for single selection
    if (singleElementId) {
      const domEl = comp.shadow.querySelector(`[data-element-id="${singleElementId}"]`) as HTMLElement;
      if (domEl) {
        this.showResizeHandles(domEl, componentId, singleElementId);
      }
    } else {
      this.hideResizeHandles();
    }

    this.updateZoomDependentSizes();
  }

  showHover(componentId: string, elementId: string): void {
    const comp = this.renderer.getRenderedComponent(componentId);
    if (!comp) return;

    const domEl = comp.shadow.querySelector(`[data-element-id="${elementId}"]`) as HTMLElement;
    if (!domEl) {
      this.hideHover();
      return;
    }

    this.positionOverlay(this.hoverOverlay, domEl);
    this.hoverOverlay.style.display = 'block';
  }

  hideHover(): void {
    this.hoverOverlay.style.display = 'none';
  }

  hideAll(): void {
    this.hideHover();
    for (const overlay of this.selectionOverlays) {
      overlay.remove();
    }
    this.selectionOverlays = [];
    this.hideResizeHandles();
  }

  private positionOverlay(overlay: HTMLElement, domEl: HTMLElement): void {
    const rect = domEl.getBoundingClientRect();
    const topLeft = this.engine.screenToWorld(rect.left, rect.top);
    const bottomRight = this.engine.screenToWorld(rect.right, rect.bottom);
    const w = bottomRight.x - topLeft.x;
    const h = bottomRight.y - topLeft.y;

    overlay.style.left = `${topLeft.x}px`;
    overlay.style.top = `${topLeft.y}px`;
    overlay.style.width = `${w}px`;
    overlay.style.height = `${h}px`;
  }

  showComponentSelection(componentId: string, frameEl: HTMLElement): void {
    this.hideAll();
    this.showResizeHandles(frameEl, componentId, null);
  }

  clearComponentSelection(): void {
    this.hideResizeHandles();
  }

  private showResizeHandles(domEl: HTMLElement, componentId: string, elementId: string | null): void {
    const rect = domEl.getBoundingClientRect();
    const topLeft = this.engine.screenToWorld(rect.left, rect.top);
    const bottomRight = this.engine.screenToWorld(rect.right, rect.bottom);
    const w = bottomRight.x - topLeft.x;
    const h = bottomRight.y - topLeft.y;

    const positions: Record<HandleDirection, { x: number; y: number }> = {
      nw: { x: topLeft.x, y: topLeft.y },
      n: { x: topLeft.x + w / 2, y: topLeft.y },
      ne: { x: bottomRight.x, y: topLeft.y },
      e: { x: bottomRight.x, y: topLeft.y + h / 2 },
      se: { x: bottomRight.x, y: bottomRight.y },
      s: { x: topLeft.x + w / 2, y: bottomRight.y },
      sw: { x: topLeft.x, y: bottomRight.y },
      w: { x: topLeft.x, y: topLeft.y + h / 2 },
    };

    for (const [dir, handle] of this.resizeHandles) {
      const pos = positions[dir];
      const handleSize = 8 / this.currentZoom;
      handle.style.left = `${pos.x - handleSize / 2}px`;
      handle.style.top = `${pos.y - handleSize / 2}px`;
      handle.style.width = `${handleSize}px`;
      handle.style.height = `${handleSize}px`;
      handle.style.display = 'block';
      handle.dataset.componentId = componentId;
      if (elementId !== null) {
        handle.dataset.elementId = elementId;
      } else {
        delete handle.dataset.elementId;
      }
    }
  }

  private hideResizeHandles(): void {
    for (const handle of this.resizeHandles.values()) {
      handle.style.display = 'none';
    }
  }

  private updateZoomDependentSizes(): void {
    const border = 2 / this.currentZoom;
    const hoverBorder = 1 / this.currentZoom;
    const handleSize = 8 / this.currentZoom;
    const handleBorder = 1.5 / this.currentZoom;

    for (const overlay of this.selectionOverlays) {
      overlay.style.borderWidth = `${border}px`;
    }

    this.hoverOverlay.style.borderWidth = `${hoverBorder}px`;

    for (const handle of this.resizeHandles.values()) {
      if (handle.style.display !== 'none') {
        handle.style.width = `${handleSize}px`;
        handle.style.height = `${handleSize}px`;
        handle.style.borderWidth = `${handleBorder}px`;
      }
    }
  }

  // ── Resize interaction ──

  private onResizeStart = (e: PointerEvent, direction: HandleDirection): void => {
    e.stopPropagation();
    e.preventDefault();

    const handle = this.resizeHandles.get(direction)!;
    const componentId = handle.dataset.componentId!;
    const elementId = handle.dataset.elementId ?? null;

    const comp = this.renderer.getRenderedComponent(componentId);
    if (!comp) return;

    let domEl: HTMLElement;
    if (elementId !== null) {
      const el = comp.shadow.querySelector(`[data-element-id="${elementId}"]`) as HTMLElement;
      if (!el) return;
      domEl = el;
    } else {
      // Component-level resize — operate on the frame element
      const frame = comp.wrapper.querySelector('.component-frame') as HTMLElement;
      if (!frame) return;
      domEl = frame;
    }

    const rect = domEl.getBoundingClientRect();

    this.resizing = {
      direction,
      componentId,
      elementId,
      startRect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      startPointer: { x: e.clientX, y: e.clientY },
      domElement: domEl,
    };

    // No pointer capture — move/up listeners are already on window
  };

  private onResizeMove = (e: PointerEvent): void => {
    if (!this.resizing) return;

    const dx = e.clientX - this.resizing.startPointer.x;
    const dy = e.clientY - this.resizing.startPointer.y;
    const dir = this.resizing.direction;

    let newWidth = this.resizing.startRect.width;
    let newHeight = this.resizing.startRect.height;

    if (dir.includes('e')) newWidth += dx;
    if (dir.includes('w')) newWidth -= dx;
    if (dir.includes('s')) newHeight += dy;
    if (dir.includes('n')) newHeight -= dy;

    // Minimum size
    newWidth = Math.max(20, newWidth);
    newHeight = Math.max(20, newHeight);

    // Convert from screen pixels to world pixels
    const worldWidth = newWidth / this.currentZoom;
    const worldHeight = newHeight / this.currentZoom;

    // Apply directly for instant feedback
    this.resizing.domElement.style.width = `${worldWidth}px`;
    this.resizing.domElement.style.height = `${worldHeight}px`;

    // Update overlays
    if (this.resizing.elementId !== null) {
      const ids = new Set([this.resizing.elementId]);
      this.showSelection(this.resizing.componentId, ids);
    } else {
      // Component-level: reposition the resize handles around the updated frame
      this.showComponentSelection(this.resizing.componentId, this.resizing.domElement);
    }
  };

  private onResizeEnd = (_e: PointerEvent): void => {
    if (!this.resizing) return;

    const { componentId, elementId, domElement } = this.resizing;
    const finalWidth = domElement.style.width;
    const finalHeight = domElement.style.height;

    this.resizing = null;

    // Commit via IPC
    const api = (window as any).canvasAPI;
    if (!api) return;

    if (elementId !== null) {
      api.canvas.updateElement(componentId, elementId, {
        styles: { width: finalWidth, height: finalHeight },
      });
    } else {
      api.canvas.resizeComponent(componentId, parseFloat(finalWidth), parseFloat(finalHeight));
    }
  };
}
