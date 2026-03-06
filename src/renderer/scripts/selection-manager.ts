import { CanvasEngine } from './canvas-engine';
import { ComponentRenderer } from './component-renderer';
import { OverlayManager } from './overlay-manager';
import { PropertiesSidebar } from './properties-sidebar';
import type { ElementNode } from '../../shared/canvas-types';

export type SelectionMode = 'idle' | 'component' | 'element';

export interface SelectionState {
  mode: SelectionMode;
  activeComponentId: string | null;
  selectedElementIds: Set<string>;
}

export type SelectionChangeCallback = (state: SelectionState) => void;

const DOUBLE_CLICK_THRESHOLD = 300;

export class SelectionManager {
  private viewport: HTMLElement;
  private engine: CanvasEngine;
  private renderer: ComponentRenderer;
  private overlayManager: OverlayManager;
  private sidebar: PropertiesSidebar;

  private mode: SelectionMode = 'idle';
  private activeComponentId: string | null = null;
  private selectedElementIds = new Set<string>();
  private listeners: SelectionChangeCallback[] = [];

  // Double-click tracking
  private lastClickTime = 0;
  private lastClickComponentId: string | null = null;
  private lastClickElementId: string | null = null;

  // Inline text editing
  private editingElement: HTMLElement | null = null;
  private editingComponentId: string | null = null;
  private editingElementId: string | null = null;

  constructor(
    viewport: HTMLElement,
    engine: CanvasEngine,
    renderer: ComponentRenderer,
    overlayManager: OverlayManager,
    sidebar: PropertiesSidebar
  ) {
    this.viewport = viewport;
    this.engine = engine;
    this.renderer = renderer;
    this.overlayManager = overlayManager;
    this.sidebar = sidebar;

    // Wire component selection → frame resize handles + properties panel
    renderer.onSelectionChange((ids) => {
      if (this.mode === 'component' && ids.length === 1) {
        const frameEl = renderer.getFrameElement(ids[0]);
        if (frameEl) overlayManager.showComponentSelection(ids[0], frameEl);
        const comp = renderer.getRenderedComponent(ids[0]);
        sidebar.showComponentPanel(ids[0], comp?.frameProps);
      } else if (this.mode === 'component') {
        overlayManager.clearComponentSelection();
        sidebar.hide();
      }
    });

    // Hide resize handles during drag, re-show after
    renderer.onDragStateChange((isDragging) => {
      if (isDragging) {
        overlayManager.clearComponentSelection();
      } else {
        const ids = renderer.getSelectedIds();
        if (this.mode === 'component' && ids.length === 1) {
          const frameEl = renderer.getFrameElement(ids[0]);
          if (frameEl) overlayManager.showComponentSelection(ids[0], frameEl);
        }
      }
    });

    this.setup();
  }

  private setup(): void {
    // Capture phase to intercept before component handlers
    this.viewport.addEventListener('pointerdown', this.onPointerDown, true);
    this.viewport.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('keydown', this.onKeyDown);
  }

  getMode(): SelectionMode {
    return this.mode;
  }

  getActiveComponentId(): string | null {
    return this.activeComponentId;
  }

  isInElementMode(): boolean {
    return this.mode === 'element';
  }

  onSelectionChange(cb: SelectionChangeCallback): void {
    this.listeners.push(cb);
  }

  private notifyChange(): void {
    const state: SelectionState = {
      mode: this.mode,
      activeComponentId: this.activeComponentId,
      selectedElementIds: new Set(this.selectedElementIds),
    };
    for (const cb of this.listeners) cb(state);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.engine.isSpaceDown() || this.engine.isCurrentlyPanning()) return;
    if (this.editingElement) return; // Don't process clicks during inline editing

    // Don't intercept clicks on resize handles — let overlay-manager handle them
    const target = e.target as HTMLElement;
    if (target?.classList?.contains('resize-handle')) return;

    const now = Date.now();
    const path = e.composedPath() as HTMLElement[];

    // Walk composed path to find element-id and component-id
    let elementId: string | null = null;
    let componentId: string | null = null;
    let shadowElement: HTMLElement | null = null;

    for (const node of path) {
      if (!(node instanceof HTMLElement)) continue;
      if (!elementId && node.dataset?.elementId) {
        elementId = node.dataset.elementId;
        shadowElement = node;
      }
      if (!componentId && node.dataset?.componentId) {
        componentId = node.dataset.componentId;
      }
    }

    if (this.mode === 'idle' || this.mode === 'component') {
      if (componentId) {
        // Check for double-click to enter element mode
        const isDoubleClick =
          now - this.lastClickTime < DOUBLE_CLICK_THRESHOLD &&
          this.lastClickComponentId === componentId;

        if (isDoubleClick && this.mode === 'component') {
          // Enter element mode
          this.enterElementMode(componentId);
          if (elementId) {
            this.selectElement(elementId, false);
          }
          e.stopPropagation();
          e.preventDefault();
        } else {
          // Normal component click — let existing handlers deal with it
          // Track mode transition from idle to component
          if (this.mode === 'idle') {
            this.mode = 'component';
          }
          this.lastClickTime = now;
          this.lastClickComponentId = componentId;
          this.lastClickElementId = elementId;
        }
      }
      return;
    }

    // Element mode
    if (this.mode === 'element') {
      if (componentId === this.activeComponentId && elementId) {
        // Check for double-click on same element → inline text edit
        const isDoubleClickElement =
          now - this.lastClickTime < DOUBLE_CLICK_THRESHOLD &&
          this.lastClickElementId === elementId;

        if (isDoubleClickElement) {
          this.startInlineEdit(elementId);
        } else {
          this.selectElement(elementId, e.shiftKey);
        }

        this.lastClickTime = now;
        this.lastClickElementId = elementId;
        this.lastClickComponentId = componentId;

        e.stopPropagation();
        e.preventDefault();
      } else if (componentId && componentId !== this.activeComponentId) {
        // Clicked different component — exit element mode, select that component
        this.exitElementMode();
        this.renderer.select(componentId, false);
        this.mode = 'component';
        this.lastClickTime = now;
        this.lastClickComponentId = componentId;
        this.lastClickElementId = null;
        this.notifyChange();
        e.stopPropagation();
        e.preventDefault();
      } else if (!componentId) {
        // Clicked background — exit to idle
        this.exitElementMode();
        this.renderer.select(null);
        this.mode = 'idle';
        this.lastClickTime = 0;
        this.lastClickComponentId = null;
        this.lastClickElementId = null;
        this.notifyChange();
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.mode !== 'element' || !this.activeComponentId) return;
    if (this.engine.isSpaceDown() || this.engine.isCurrentlyPanning()) return;

    const path = e.composedPath() as HTMLElement[];
    let elementId: string | null = null;
    let componentId: string | null = null;

    for (const node of path) {
      if (!(node instanceof HTMLElement)) continue;
      if (!elementId && node.dataset?.elementId) {
        elementId = node.dataset.elementId;
      }
      if (!componentId && node.dataset?.componentId) {
        componentId = node.dataset.componentId;
      }
    }

    if (componentId === this.activeComponentId && elementId) {
      this.overlayManager.showHover(this.activeComponentId, elementId);
    } else {
      this.overlayManager.hideHover();
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.editingElement) {
      if (e.key === 'Escape') {
        this.commitInlineEdit();
      }
      return;
    }

    // Delete/Backspace in element mode → delete selected elements
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.mode === 'element' && this.activeComponentId) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isEditing = tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable;
      if (!isEditing && this.selectedElementIds.size > 0) {
        e.preventDefault();
        const api = (window as any).canvasAPI;
        if (api) {
          for (const elId of this.selectedElementIds) {
            api.canvas.deleteElement(this.activeComponentId, elId);
          }
        }
        this.selectedElementIds.clear();
        this.overlayManager.hideAll();
        this.sidebar.hide();
        this.notifyChange();
        return;
      }
    }

    if (e.key === 'Escape') {
      if (this.mode === 'element') {
        const prevComponentId = this.activeComponentId;
        this.exitElementMode();
        // Set mode before calling renderer.select so the onSelectionChange callback
        // fires while mode is already 'component', correctly triggering showComponentSelection
        this.mode = 'component';
        if (prevComponentId) {
          this.renderer.select(prevComponentId, false);
        }
        this.notifyChange();
      } else if (this.mode === 'component') {
        this.renderer.select(null);
        this.mode = 'idle';
        this.overlayManager.hideAll();
        this.notifyChange();
      }
    }
  };

  enterElementMode(componentId: string): void {
    this.overlayManager.clearComponentSelection();
    this.mode = 'element';
    this.activeComponentId = componentId;
    this.selectedElementIds.clear();

    // Add visual indicator that component is in element-edit mode
    const comp = this.renderer.getRenderedComponent(componentId);
    if (comp) {
      comp.wrapper.classList.add('element-mode');
    }

    this.notifyChange();
  }

  exitElementMode(): void {
    if (this.editingElement) {
      this.commitInlineEdit();
    }

    // Remove element-mode visual indicator
    if (this.activeComponentId) {
      const comp = this.renderer.getRenderedComponent(this.activeComponentId);
      if (comp) {
        comp.wrapper.classList.remove('element-mode');
      }
    }

    this.selectedElementIds.clear();
    this.activeComponentId = null;
    this.overlayManager.hideAll();
    this.sidebar.hide();
  }

  selectElement(elementId: string, additive: boolean): void {
    if (!this.activeComponentId) return;

    if (additive) {
      if (this.selectedElementIds.has(elementId)) {
        this.selectedElementIds.delete(elementId);
      } else {
        this.selectedElementIds.add(elementId);
      }
    } else {
      this.selectedElementIds.clear();
      this.selectedElementIds.add(elementId);
    }

    // Update overlays
    this.overlayManager.showSelection(this.activeComponentId, this.selectedElementIds);

    // Update sidebar
    this.updateSidebar();
    this.notifyChange();
  }

  private updateSidebar(): void {
    if (!this.activeComponentId || this.selectedElementIds.size === 0) {
      this.sidebar.hide();
      return;
    }

    const elements: ElementNode[] = [];
    for (const elId of this.selectedElementIds) {
      const node = this.renderer.findElementNode(this.activeComponentId, elId);
      if (node) elements.push(node);
    }

    if (elements.length > 0) {
      this.sidebar.update(this.activeComponentId, elements);
    } else {
      this.sidebar.hide();
    }
  }

  // ── Inline Text Editing ──

  private startInlineEdit(elementId: string): void {
    if (!this.activeComponentId) return;

    const comp = this.renderer.getRenderedComponent(this.activeComponentId);
    if (!comp) return;

    const domEl = comp.shadow.querySelector(`[data-element-id="${elementId}"]`) as HTMLElement;
    if (!domEl) return;

    // Only allow inline editing on elements that contain text (no complex child elements)
    const node = this.renderer.findElementNode(this.activeComponentId, elementId);
    if (!node) return;

    // Check the ElementNode tree: textContent set directly, or only #text children
    const hasTextInTree = node.textContent !== undefined ||
      (node.children.length > 0 && node.children.every(c => c.tag === '#text'));

    // Also check the actual DOM: if the element has no child elements, it's purely text
    const hasOnlyTextInDOM = domEl.children.length === 0 && (domEl.textContent?.trim() ?? '').length > 0;

    if (!hasTextInTree && !hasOnlyTextInDOM && node.children.length > 0) return;

    this.editingElement = domEl;
    this.editingComponentId = this.activeComponentId;
    this.editingElementId = elementId;

    domEl.contentEditable = 'true';
    domEl.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(domEl);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // Hide overlays during edit
    this.overlayManager.hideAll();

    // Listen for blur to commit
    domEl.addEventListener('blur', this.onEditBlur);
    domEl.addEventListener('keydown', this.onEditKeyDown);
  }

  private onEditBlur = (): void => {
    this.commitInlineEdit();
  };

  private onEditKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.commitInlineEdit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.commitInlineEdit();
    }
  };

  private commitInlineEdit(): void {
    if (!this.editingElement || !this.editingComponentId || !this.editingElementId) return;

    const newText = this.editingElement.textContent ?? '';

    this.editingElement.removeEventListener('blur', this.onEditBlur);
    this.editingElement.removeEventListener('keydown', this.onEditKeyDown);
    this.editingElement.contentEditable = 'false';

    const componentId = this.editingComponentId;
    const elementId = this.editingElementId;

    this.editingElement = null;
    this.editingComponentId = null;
    this.editingElementId = null;

    // Commit via IPC
    const api = (window as any).canvasAPI;
    if (api) {
      api.canvas.updateElement(componentId, elementId, { textContent: newText });
    }

    // Restore overlays
    if (this.activeComponentId && this.selectedElementIds.size > 0) {
      this.overlayManager.showSelection(this.activeComponentId, this.selectedElementIds);
    }
  }
}
