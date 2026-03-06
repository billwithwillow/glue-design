import { CanvasEngine } from './canvas-engine';
import { ComponentRenderer } from './component-renderer';
import type { SelectionManager } from './selection-manager';

const MIN_MARQUEE_SIZE = 3; // px — below this it's a deselect click

export class MarqueeSelection {
  private viewport: HTMLElement;
  private engine: CanvasEngine;
  private renderer: ComponentRenderer;
  private selectionManager: SelectionManager;

  private active = false;
  private startScreen = { x: 0, y: 0 };
  private rect: HTMLElement | null = null;

  constructor(viewport: HTMLElement, engine: CanvasEngine, renderer: ComponentRenderer, selectionManager: SelectionManager) {
    this.viewport = viewport;
    this.engine = engine;
    this.renderer = renderer;
    this.selectionManager = selectionManager;
    this.setup();
  }

  private setup(): void {
    this.viewport.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent): void => {
    // Only activate on left-click directly on viewport background
    if (e.button !== 0) return;
    if (e.target !== this.viewport) return;

    // Don't interfere with space+pan
    if (this.engine.isSpaceDown() || this.engine.isCurrentlyPanning()) return;

    // Don't start marquee in element mode
    if (this.selectionManager.isInElementMode()) return;

    this.active = true;
    this.startScreen = { x: e.clientX, y: e.clientY };

    // Create marquee rectangle element
    this.rect = document.createElement('div');
    this.rect.className = 'marquee-rect';
    this.rect.style.left = `${e.clientX}px`;
    this.rect.style.top = `${e.clientY}px`;
    this.rect.style.width = '0';
    this.rect.style.height = '0';
    document.body.appendChild(this.rect);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.active || !this.rect) return;

    const x = Math.min(e.clientX, this.startScreen.x);
    const y = Math.min(e.clientY, this.startScreen.y);
    const w = Math.abs(e.clientX - this.startScreen.x);
    const h = Math.abs(e.clientY - this.startScreen.y);

    this.rect.style.left = `${x}px`;
    this.rect.style.top = `${y}px`;
    this.rect.style.width = `${w}px`;
    this.rect.style.height = `${h}px`;

    // Live intersection test
    if (w > MIN_MARQUEE_SIZE || h > MIN_MARQUEE_SIZE) {
      const worldStart = this.engine.screenToWorld(
        Math.min(e.clientX, this.startScreen.x),
        Math.min(e.clientY, this.startScreen.y)
      );
      const worldEnd = this.engine.screenToWorld(
        Math.max(e.clientX, this.startScreen.x),
        Math.max(e.clientY, this.startScreen.y)
      );

      const marqueeRect = {
        x: worldStart.x,
        y: worldStart.y,
        width: worldEnd.x - worldStart.x,
        height: worldEnd.y - worldStart.y,
      };

      const hits = this.getIntersecting(marqueeRect);
      this.renderer.selectMultiple(hits);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.active) return;
    this.active = false;

    // Remove marquee rect
    if (this.rect) {
      this.rect.remove();
      this.rect = null;
    }

    const w = Math.abs(e.clientX - this.startScreen.x);
    const h = Math.abs(e.clientY - this.startScreen.y);

    if (w < MIN_MARQUEE_SIZE && h < MIN_MARQUEE_SIZE) {
      // Tiny marquee = click on background → deselect all
      this.renderer.select(null);
      return;
    }

    // Final intersection
    const worldStart = this.engine.screenToWorld(
      Math.min(e.clientX, this.startScreen.x),
      Math.min(e.clientY, this.startScreen.y)
    );
    const worldEnd = this.engine.screenToWorld(
      Math.max(e.clientX, this.startScreen.x),
      Math.max(e.clientY, this.startScreen.y)
    );

    const marqueeRect = {
      x: worldStart.x,
      y: worldStart.y,
      width: worldEnd.x - worldStart.x,
      height: worldEnd.y - worldStart.y,
    };

    const hits = this.getIntersecting(marqueeRect);
    this.renderer.selectMultiple(hits);
  };

  /** AABB intersection test: returns IDs of components overlapping the marquee */
  private getIntersecting(marquee: { x: number; y: number; width: number; height: number }): string[] {
    const allBounds = this.renderer.getAllComponentBoundsWithIds();
    const hits: string[] = [];

    for (const comp of allBounds) {
      // AABB overlap check
      if (
        comp.x < marquee.x + marquee.width &&
        comp.x + comp.width > marquee.x &&
        comp.y < marquee.y + marquee.height &&
        comp.y + comp.height > marquee.y
      ) {
        hits.push(comp.id);
      }
    }

    return hits;
  }
}
