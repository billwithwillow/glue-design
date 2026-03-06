export interface CanvasState {
  panX: number;
  panY: number;
  zoom: number;
}

type StateChangeCallback = (state: CanvasState) => void;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5.0;
const TRACKPAD_ZOOM_SENSITIVITY = 0.01;
const WHEEL_ZOOM_SENSITIVITY = 0.002;
const PAN_SPEED = 1;

export class CanvasEngine {
  private viewport: HTMLElement;
  private world: HTMLElement;
  private state: CanvasState = { panX: 0, panY: 0, zoom: 1 };
  private listeners: StateChangeCallback[] = [];
  private spaceDown = false;
  private isPanning = false;
  private lastPointer = { x: 0, y: 0 };
  private rafId: number | null = null;
  private dirty = false;

  constructor(viewport: HTMLElement, world: HTMLElement) {
    this.viewport = viewport;
    this.world = world;
    this.setupEventListeners();
    this.applyTransform();
  }

  private setupEventListeners(): void {
    // Wheel: ctrl/meta → zoom, else → pan
    this.viewport.addEventListener('wheel', this.onWheel, { passive: false });

    // Space key for pan mode
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Mouse for space+drag and middle-click drag
    this.viewport.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Zoom toward cursor
      const rect = this.viewport.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const oldZoom = this.state.zoom;
      const isTrackpadPinch = e.deltaMode === 0 && Math.abs(e.deltaY) < 50;
      const sensitivity = isTrackpadPinch ? TRACKPAD_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY;
      const delta = -e.deltaY * sensitivity;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * Math.exp(delta)));

      // Zoom toward cursor: keep the world point under the cursor fixed
      const worldX = (screenX - this.state.panX) / oldZoom;
      const worldY = (screenY - this.state.panY) / oldZoom;
      this.state.panX = screenX - worldX * newZoom;
      this.state.panY = screenY - worldY * newZoom;
      this.state.zoom = newZoom;
    } else {
      // Pan
      this.state.panX -= e.deltaX * PAN_SPEED;
      this.state.panY -= e.deltaY * PAN_SPEED;
    }

    this.scheduleUpdate();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !e.repeat) {
      this.spaceDown = true;
      this.viewport.style.cursor = 'grab';
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spaceDown = false;
      if (!this.isPanning) {
        this.viewport.style.cursor = '';
      }
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    // Space+click or middle button → start pan
    if (this.spaceDown || e.button === 1) {
      this.isPanning = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.viewport.style.cursor = 'grabbing';
      this.viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isPanning) return;

    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };

    this.state.panX += dx;
    this.state.panY += dy;
    this.scheduleUpdate();
  };

  private onPointerUp = (_e: PointerEvent): void => {
    if (this.isPanning) {
      this.isPanning = false;
      this.viewport.style.cursor = this.spaceDown ? 'grab' : '';
    }
  };

  private scheduleUpdate(): void {
    if (!this.dirty) {
      this.dirty = true;
      this.rafId = requestAnimationFrame(() => {
        this.applyTransform();
        this.dirty = false;
      });
    }
  }

  private applyTransform(): void {
    const { panX, panY, zoom } = this.state;
    this.world.style.transform = `matrix(${zoom}, 0, 0, ${zoom}, ${panX}, ${panY})`;

    // Update background grid
    const gridSize = 20 * zoom;
    this.viewport.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    this.viewport.style.backgroundPosition = `${panX}px ${panY}px`;

    // Notify listeners
    for (const cb of this.listeners) {
      cb(this.state);
    }
  }

  // Public API

  isSpaceDown(): boolean {
    return this.spaceDown;
  }

  isCurrentlyPanning(): boolean {
    return this.isPanning;
  }

  getState(): CanvasState {
    return { ...this.state };
  }

  setZoom(zoom: number, centerOnViewport = true): void {
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

    if (centerOnViewport) {
      const rect = this.viewport.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      const worldX = (cx - this.state.panX) / this.state.zoom;
      const worldY = (cy - this.state.panY) / this.state.zoom;
      this.state.panX = cx - worldX * newZoom;
      this.state.panY = cy - worldY * newZoom;
    }

    this.state.zoom = newZoom;
    this.scheduleUpdate();
  }

  fitAll(elements: { x: number; y: number; width: number; height: number }[]): void {
    if (elements.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    }

    const padding = 80;
    const rect = this.viewport.getBoundingClientRect();
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;

    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min(rect.width / contentW, rect.height / contentH))
    );

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    this.state.zoom = zoom;
    this.state.panX = rect.width / 2 - centerX * zoom;
    this.state.panY = rect.height / 2 - centerY * zoom;
    this.scheduleUpdate();
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = this.viewport.getBoundingClientRect();
    return {
      x: (sx - rect.left - this.state.panX) / this.state.zoom,
      y: (sy - rect.top - this.state.panY) / this.state.zoom,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const rect = this.viewport.getBoundingClientRect();
    return {
      x: wx * this.state.zoom + this.state.panX + rect.left,
      y: wy * this.state.zoom + this.state.panY + rect.top,
    };
  }

  onStateChange(cb: StateChangeCallback): void {
    this.listeners.push(cb);
  }

  destroy(): void {
    this.viewport.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.viewport.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }
}
