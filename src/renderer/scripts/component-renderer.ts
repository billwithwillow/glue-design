import { CanvasEngine } from './canvas-engine';
import type { ElementNode, FrameProps } from '../../shared/canvas-types';
import { elementTreeToHTML } from '../../shared/element-tree';
import { elementTreeToDOM } from './element-tree-dom';

interface RenderedComponent {
  id: string;
  name: string;
  rootElements: ElementNode[];
  cssRules: string;
  width: number;
  height: number;
  x: number;
  y: number;
  frameProps?: FrameProps;
  parentId?: string;
  childRefs?: string[];
  wrapper: HTMLElement;
  shadow: ShadowRoot;
  contentDiv: HTMLElement;
  knownElementIds: Set<string>;
  resolveTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_SHADOW = '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)';
const SELECTION_RING = '0 0 0 2px rgba(99, 102, 241, 0.15)';

/**
 * Apply frame-level visual properties to the frame element and its shadow content div.
 * Selection state is handled here so box-shadow/border stay in sync with selection.
 */
function applyFrameStyles(frame: HTMLElement, contentDiv: HTMLElement, frameProps: FrameProps | undefined, isSelected: boolean): void {
  // Corner radius
  frame.style.borderRadius = `${frameProps?.cornerRadius ?? 12}px`;

  // Box shadow: selection ring is always added when selected
  const baseShadow = frameProps?.shadow !== undefined ? frameProps.shadow : DEFAULT_SHADOW;
  if (isSelected) {
    const noBase = !baseShadow || baseShadow === 'none';
    frame.style.boxShadow = noBase ? SELECTION_RING : `${SELECTION_RING}, ${baseShadow}`;
    // Let CSS handle border-color for selected state (#6366f1)
    frame.style.border = '';
  } else {
    frame.style.boxShadow = baseShadow;
    frame.style.border = frameProps?.border ?? '1.5px solid #e5e5e5';
  }

  // Fill: set on contentDiv (inside shadow DOM) so CSS states on the frame element still apply
  if (frameProps?.fill !== undefined) {
    contentDiv.style.background = frameProps.fill;
  } else {
    contentDiv.style.background = '';
  }

  // Clip content
  const clip = frameProps?.clipContent !== false;
  contentDiv.style.overflow = clip ? 'hidden' : 'visible';
  frame.style.overflow = clip ? '' : 'visible';
}

const MATERIALIZE_CSS = `
@keyframes glue-materialize {
  from { opacity: 0; filter: blur(3px); transform: translateY(5px); }
  to   { opacity: 1; filter: blur(0);   transform: translateY(0);   }
}
.glue-new {
  animation: glue-materialize 0.4s ease-out forwards;
}
`;

type CountChangeCallback = (count: number) => void;
type SelectionChangeCallback = (ids: string[]) => void;

export class ComponentRenderer {
  private world: HTMLElement;
  private engine: CanvasEngine;
  private components = new Map<string, RenderedComponent>();
  private selectedIds = new Set<string>();
  private countListeners: CountChangeCallback[] = [];
  private selectionListeners: SelectionChangeCallback[] = [];

  // Drag state (multi-drag)
  private dragging: {
    startX: number;
    startY: number;
    origPositions: Map<string, { x: number; y: number }>;
    dropTargetId: string | null;
    insertIndex: number;
    targetElementId: string | null;
  } | null = null;

  // Insertion guideline element
  private insertionGuide: HTMLElement | null = null;

  constructor(world: HTMLElement, engine: CanvasEngine) {
    this.world = world;
    this.engine = engine;
    this.setupGlobalListeners();
    this.setupIpcListeners();
  }

  private setupGlobalListeners(): void {
    // Background deselect is now handled by MarqueeSelection
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);
  }

  private setupIpcListeners(): void {
    const api = (window as any).canvasAPI;
    if (!api) return;

    api.canvas.onComponentCreated((component: any) => {
      this.addComponent(component);
    });

    api.canvas.onComponentUpdated((component: any) => {
      this.updateComponent(component);
    });

    api.canvas.onElementsAppended((data: { componentId: string; targetHtmlId: string | null; newNodes: ElementNode[] }) => {
      this.appendElements(data.componentId, data.targetHtmlId, data.newNodes);
    });

    api.canvas.onComponentDeleted((id: string) => {
      this.removeComponent(id);
    });

    api.canvas.onGetSelected((requestId: string) => {
      const selectedArray = this.getSelectedIds().map((id) => this.getComponentData(id)).filter(Boolean);
      api.canvas.respondSelected({ requestId, result: selectedArray.length === 1 ? selectedArray[0] : selectedArray.length > 0 ? selectedArray : null });
    });

    api.canvas.onGetComponentRect(({ requestId, componentId }: { requestId: string; componentId: string }) => {
      const frame = this.getFrameElement(componentId);
      const rect = frame ? frame.getBoundingClientRect() : null;
      api.canvas.respondComponentRect({
        requestId,
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      });
    });
  }

  addComponent(data: { id: string; name: string; rootElements: ElementNode[]; cssRules: string; width: number; height: number; x: number; y: number; frameProps?: FrameProps; parentId?: string; childRefs?: string[] }): void {
    // Wrapper positioned in world coordinates
    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-component';
    wrapper.style.position = 'absolute';
    wrapper.style.left = '0';
    wrapper.style.top = '0';
    wrapper.style.transform = `translate(${data.x}px, ${data.y}px)`;
    wrapper.dataset.componentId = data.id;

    // Label
    const label = document.createElement('div');
    label.className = 'component-label';
    label.textContent = data.name;
    wrapper.appendChild(label);

    // Frame with Shadow DOM
    const frame = document.createElement('div');
    frame.className = 'component-frame';
    frame.style.width = `${data.width}px`;
    frame.style.height = `${data.height}px`;
    wrapper.appendChild(frame);

    const shadow = frame.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host { display: block; width: 100%; height: 100%; } ${data.cssRules}${MATERIALIZE_CSS}`;
    shadow.appendChild(style);

    const contentDiv = document.createElement('div');
    contentDiv.style.width = '100%';
    contentDiv.style.height = '100%';
    contentDiv.appendChild(elementTreeToDOM(data.rootElements));
    shadow.appendChild(contentDiv);

    applyFrameStyles(frame, contentDiv, data.frameProps, false);

    // Click on frame content → select only (no drag)
    frame.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.select(data.id, e.shiftKey);
    });

    // Click on wrapper (outside frame) → select + start drag
    wrapper.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.select(data.id, e.shiftKey);
      this.startDrag(e, frame);
    });

    wrapper.classList.add('holographic');
    this.world.appendChild(wrapper);

    const knownElementIds = this.collectElementIds(data.rootElements);
    const rendered: RenderedComponent = {
      id: data.id,
      name: data.name,
      rootElements: data.rootElements,
      cssRules: data.cssRules,
      width: data.width,
      height: data.height,
      x: data.x,
      y: data.y,
      frameProps: data.frameProps,
      parentId: data.parentId,
      childRefs: data.childRefs,
      wrapper,
      shadow,
      contentDiv,
      knownElementIds,
      resolveTimer: null,
    };
    this.components.set(data.id, rendered);
    this.renderNestedChildren(rendered);
    this.scheduleResolve(rendered);
    this.notifyCountChange();

    // Hide empty state
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';
  }

  updateComponent(data: { id: string; name?: string; rootElements?: ElementNode[]; cssRules?: string; width?: number; height?: number; parentId?: string; childRefs?: string[]; frameProps?: FrameProps }): void {
    const comp = this.components.get(data.id);
    if (!comp) return;

    if (data.name !== undefined) {
      comp.name = data.name;
      const label = comp.wrapper.querySelector('.component-label');
      if (label) label.textContent = data.name;
    }

    if (data.rootElements !== undefined) {
      const structureChanged = !this.sameStructure(comp.rootElements, data.rootElements);
      comp.rootElements = data.rootElements;

      if (structureChanged) {
        // Full re-render
        comp.contentDiv.innerHTML = '';
        comp.contentDiv.appendChild(elementTreeToDOM(data.rootElements));

        // Animate newly-added elements
        const newIds = this.collectElementIds(data.rootElements);
        for (const id of newIds) {
          if (!comp.knownElementIds.has(id)) {
            const el = comp.shadow.querySelector(`[data-element-id="${id}"]`);
            if (el) el.classList.add('glue-new');
          }
        }
        comp.knownElementIds = newIds;
        this.scheduleResolve(comp);
      } else {
        // Surgical update — sync styles/classes/attributes/text
        this.surgicalUpdate(comp.shadow, data.rootElements);
      }
    }

    if (data.cssRules !== undefined) {
      comp.cssRules = data.cssRules;
      const style = comp.shadow.querySelector('style');
      if (style) style.textContent = `:host { display: block; width: 100%; height: 100%; } ${data.cssRules}${MATERIALIZE_CSS}`;
    }

    if (data.width !== undefined) {
      comp.width = data.width;
      const frame = comp.wrapper.querySelector('.component-frame') as HTMLElement;
      if (frame) frame.style.width = `${data.width}px`;
    }

    if (data.height !== undefined) {
      comp.height = data.height;
      const frame = comp.wrapper.querySelector('.component-frame') as HTMLElement;
      if (frame) frame.style.height = `${data.height}px`;
    }

    if (data.frameProps !== undefined) {
      comp.frameProps = data.frameProps;
      const frame = comp.wrapper.querySelector('.component-frame') as HTMLElement;
      if (frame) applyFrameStyles(frame, comp.contentDiv, data.frameProps, this.selectedIds.has(data.id));
    }

    // Handle nesting state changes
    const wasNested = comp.parentId !== undefined;
    if (data.parentId !== undefined) comp.parentId = data.parentId;
    else if (data.parentId === undefined && 'parentId' in data) delete comp.parentId;
    if (data.childRefs !== undefined) comp.childRefs = data.childRefs;

    const isNested = comp.parentId !== undefined;

    // If just became nested, hide from top-level canvas
    if (!wasNested && isNested) {
      comp.wrapper.style.display = 'none';
      // Re-render inside parent
      const parent = this.components.get(comp.parentId!);
      if (parent) this.renderNestedChildren(parent);
    }
    // If just became un-nested, show on canvas
    if (wasNested && !isNested) {
      comp.wrapper.style.display = '';
      comp.wrapper.style.transform = `translate(${comp.x}px, ${comp.y}px)`;
    }

    // Re-render nested children if tree changed
    if (data.rootElements !== undefined) {
      this.renderNestedChildren(comp);
    }
  }

  // ── Selection ──

  select(id: string | null, additive = false): void {
    if (id === null) {
      // Deselect all
      for (const selId of this.selectedIds) {
        const comp = this.components.get(selId);
        if (comp) {
          comp.wrapper.classList.remove('selected');
          this.updateFrameSelection(comp, false);
        }
      }
      this.selectedIds.clear();
      this.notifySelectionChange();
      return;
    }

    if (additive) {
      // Toggle in selection set
      if (this.selectedIds.has(id)) {
        this.selectedIds.delete(id);
        const comp = this.components.get(id);
        if (comp) {
          comp.wrapper.classList.remove('selected');
          this.updateFrameSelection(comp, false);
        }
      } else {
        this.selectedIds.add(id);
        const comp = this.components.get(id);
        if (comp) {
          comp.wrapper.classList.add('selected');
          this.updateFrameSelection(comp, true);
        }
      }
    } else {
      // Clear and select single
      for (const selId of this.selectedIds) {
        if (selId === id) continue;
        const comp = this.components.get(selId);
        if (comp) {
          comp.wrapper.classList.remove('selected');
          this.updateFrameSelection(comp, false);
        }
      }
      this.selectedIds.clear();
      this.selectedIds.add(id);
      const comp = this.components.get(id);
      if (comp) {
        comp.wrapper.classList.add('selected');
        this.updateFrameSelection(comp, true);
      }
    }
    this.notifySelectionChange();
  }

  selectMultiple(ids: string[]): void {
    // Clear existing
    for (const selId of this.selectedIds) {
      const comp = this.components.get(selId);
      if (comp) {
        comp.wrapper.classList.remove('selected');
        this.updateFrameSelection(comp, false);
      }
    }
    this.selectedIds.clear();

    // Select new set
    for (const id of ids) {
      this.selectedIds.add(id);
      const comp = this.components.get(id);
      if (comp) {
        comp.wrapper.classList.add('selected');
        this.updateFrameSelection(comp, true);
      }
    }
    this.notifySelectionChange();
  }

  private updateFrameSelection(comp: RenderedComponent, isSelected: boolean): void {
    const frame = comp.wrapper.querySelector('.component-frame') as HTMLElement | null;
    if (frame) applyFrameStyles(frame, comp.contentDiv, comp.frameProps, isSelected);
  }

  getSelectedIds(): string[] {
    return Array.from(this.selectedIds);
  }

  // ── Multi-drag ──

  private startDrag(e: PointerEvent, frame: HTMLElement): void {
    // Ensure clicked component is in selection for dragging
    const origPositions = new Map<string, { x: number; y: number }>();
    for (const selId of this.selectedIds) {
      const comp = this.components.get(selId);
      if (comp) origPositions.set(selId, { x: comp.x, y: comp.y });
    }

    this.dragging = {
      startX: e.clientX,
      startY: e.clientY,
      origPositions,
      dropTargetId: null,
      insertIndex: -1,
      targetElementId: null,
    };

    // Disable pointer events on all selected frames during drag
    for (const selId of this.selectedIds) {
      const comp = this.components.get(selId);
      if (comp) {
        const f = comp.wrapper.querySelector('.component-frame') as HTMLElement;
        if (f) f.style.pointerEvents = 'none';
      }
    }
  }

  private onDragMove = (e: PointerEvent): void => {
    if (!this.dragging) return;

    const zoom = this.engine.getState().zoom;
    const dx = (e.clientX - this.dragging.startX) / zoom;
    const dy = (e.clientY - this.dragging.startY) / zoom;

    for (const [id, orig] of this.dragging.origPositions) {
      const comp = this.components.get(id);
      if (!comp) continue;
      comp.x = orig.x + dx;
      comp.y = orig.y + dy;
      comp.wrapper.style.transform = `translate(${comp.x}px, ${comp.y}px)`;
    }

    // Drop target detection (only for single-component drags)
    if (this.dragging.origPositions.size === 1) {
      const draggedId = this.dragging.origPositions.keys().next().value!;
      const dragged = this.components.get(draggedId);
      if (dragged) {
        // Center point of dragged component in world coords
        const cx = dragged.x + dragged.width / 2;
        const cy = dragged.y + dragged.height / 2;

        let newDropTarget: string | null = null;
        for (const [id, comp] of this.components) {
          if (id === draggedId) continue;
          if (comp.parentId) continue; // don't drop into nested components
          if (cx >= comp.x && cx <= comp.x + comp.width &&
              cy >= comp.y && cy <= comp.y + comp.height) {
            newDropTarget = id;
            break;
          }
        }

        // Update visual state
        if (newDropTarget !== this.dragging.dropTargetId) {
          // Remove old drop target highlight
          if (this.dragging.dropTargetId) {
            const old = this.components.get(this.dragging.dropTargetId);
            if (old) old.wrapper.classList.remove('drop-target');
          }
          // Add new
          if (newDropTarget) {
            const target = this.components.get(newDropTarget);
            if (target) target.wrapper.classList.add('drop-target');
          }
          this.dragging.dropTargetId = newDropTarget;
        }

        // Compute insertion guideline
        if (newDropTarget) {
          const slot = this.computeInsertionSlot(newDropTarget, e.clientX, e.clientY);
          this.dragging.insertIndex = slot.index;
          this.dragging.targetElementId = slot.targetElementId;
          this.showInsertionGuide(newDropTarget, slot);
        } else {
          this.hideInsertionGuide();
        }
      }
    }
  };

  private onDragEnd = (_e: PointerEvent): void => {
    if (!this.dragging) return;

    const api = (window as any).canvasAPI;
    const updates: { id: string; x: number; y: number }[] = [];

    // Clean up drop target visuals
    if (this.dragging.dropTargetId) {
      const target = this.components.get(this.dragging.dropTargetId);
      if (target) target.wrapper.classList.remove('drop-target');
    }
    this.hideInsertionGuide();

    const dropTargetId = this.dragging.dropTargetId;
    const insertIndex = this.dragging.insertIndex;
    const targetElementId = this.dragging.targetElementId;

    for (const id of this.dragging.origPositions.keys()) {
      const comp = this.components.get(id);
      if (!comp) continue;

      // Re-enable pointer events on frame
      const frame = comp.wrapper.querySelector('.component-frame') as HTMLElement;
      if (frame) frame.style.pointerEvents = '';

      // Check if this is a nest operation
      if (dropTargetId && this.dragging.origPositions.size === 1 && api) {
        api.canvas.nestComponent(id, dropTargetId, insertIndex >= 0 ? insertIndex : undefined, targetElementId ?? undefined);
        this.dragging = null;
        return;
      }

      // Check if nested component dragged outside parent → unnest
      if (comp.parentId && api) {
        const parent = this.components.get(comp.parentId);
        if (parent) {
          const cx = comp.x + comp.width / 2;
          const cy = comp.y + comp.height / 2;
          if (cx < parent.x || cx > parent.x + parent.width ||
              cy < parent.y || cy > parent.y + parent.height) {
            api.canvas.unnestComponent(id);
            this.dragging = null;
            return;
          }
        }
      }

      updates.push({ id: comp.id, x: comp.x, y: comp.y });
    }

    // Batch position update
    if (api && updates.length > 0) {
      if (updates.length === 1) {
        api.canvas.updatePosition(updates[0].id, updates[0].x, updates[0].y);
      } else {
        api.canvas.updatePositions(updates);
      }
    }

    this.dragging = null;
  };

  // ── Public accessors for selection/overlay ──

  getRenderedComponent(id: string): RenderedComponent | null {
    return this.components.get(id) ?? null;
  }

  findElementNode(componentId: string, elementId: string): ElementNode | null {
    const comp = this.components.get(componentId);
    if (!comp) return null;
    return this.findInTree(comp.rootElements, elementId);
  }

  private findInTree(nodes: ElementNode[], targetId: string): ElementNode | null {
    for (const node of nodes) {
      if (node.id === targetId) return node;
      const found = this.findInTree(node.children, targetId);
      if (found) return found;
    }
    return null;
  }

  // ── Data accessors ──

  getComponentData(id: string): any {
    const comp = this.components.get(id);
    if (!comp) return null;
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

  getAllBounds(): { x: number; y: number; width: number; height: number }[] {
    return Array.from(this.components.values()).map((c) => ({
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
    }));
  }

  getAllComponentBoundsWithIds(): { id: string; x: number; y: number; width: number; height: number }[] {
    return Array.from(this.components.values()).map((c) => ({
      id: c.id,
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
    }));
  }

  deleteSelected(): void {
    const api = (window as any).canvasAPI;
    const ids = Array.from(this.selectedIds);
    for (const id of ids) {
      this.removeComponent(id);
      api?.canvas.deleteComponent(id);
    }
  }

  removeComponent(id: string): void {
    const comp = this.components.get(id);
    if (!comp) return;
    if (comp.resolveTimer !== null) clearTimeout(comp.resolveTimer);
    comp.wrapper.remove();
    this.components.delete(id);
    this.selectedIds.delete(id);
    this.notifyCountChange();
    if (this.components.size === 0) {
      const emptyState = document.getElementById('empty-state');
      if (emptyState) emptyState.style.display = '';
    }
  }

  clearAll(): void {
    for (const comp of this.components.values()) {
      comp.wrapper.remove();
    }
    this.components.clear();
    this.selectedIds.clear();
    this.notifyCountChange();
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = '';
  }

  getCount(): number {
    return this.components.size;
  }

  onCountChange(cb: CountChangeCallback): void {
    this.countListeners.push(cb);
  }

  private notifyCountChange(): void {
    const count = this.components.size;
    for (const cb of this.countListeners) {
      cb(count);
    }
  }

  onSelectionChange(cb: SelectionChangeCallback): void {
    this.selectionListeners.push(cb);
  }

  private notifySelectionChange(): void {
    const ids = Array.from(this.selectedIds);
    for (const cb of this.selectionListeners) {
      cb(ids);
    }
  }

  // ── Nested component rendering ──

  private renderNestedChildren(parent: RenderedComponent): void {
    const placeholders = parent.shadow.querySelectorAll('[data-component-ref]');
    for (const placeholder of placeholders) {
      const childId = placeholder.getAttribute('data-component-ref');
      if (!childId) continue;

      const child = this.components.get(childId);
      if (!child) continue;

      // Clear placeholder and render child's content into it
      placeholder.innerHTML = '';

      // Add child's CSS
      const style = document.createElement('style');
      style.textContent = child.cssRules;
      placeholder.appendChild(style);

      // Add child's content
      const frag = elementTreeToDOM(child.rootElements);
      placeholder.appendChild(frag);

      // Apply child frame props as styles on placeholder
      if (child.frameProps?.fill) {
        (placeholder as HTMLElement).style.background = child.frameProps.fill;
      }
      if (child.frameProps?.cornerRadius !== undefined) {
        (placeholder as HTMLElement).style.borderRadius = `${child.frameProps.cornerRadius}px`;
      }

      // Hide child's top-level wrapper
      child.wrapper.style.display = 'none';
    }
  }

  // ── Insertion guideline logic ──

  private computeInsertionSlot(parentId: string, clientX: number, clientY: number): { index: number; targetElementId: string | null; rect: { x: number; y: number; width: number; height: number; horizontal: boolean } | null } {
    const parent = this.components.get(parentId);
    if (!parent) return { index: -1, targetElementId: null, rect: null };

    const contentDiv = parent.contentDiv;
    // Find the nearest flex container or use contentDiv's first child
    const rootEl = contentDiv.firstElementChild as HTMLElement;
    if (!rootEl) return { index: 0, targetElementId: null, rect: null };

    // Walk up from a point to find the layout container
    const container = rootEl;
    const computedStyle = window.getComputedStyle(container);
    const isRow = computedStyle.flexDirection === 'row' || computedStyle.flexDirection === 'row-reverse';
    const horizontal = !isRow; // horizontal guideline for column layout, vertical for row

    const children = Array.from(container.children).filter(
      (el) => !el.hasAttribute('data-component-ref') || el.getAttribute('data-component-ref') === ''
    );

    // Get parent frame rect to convert client coords
    const frameEl = parent.wrapper.querySelector('.component-frame');
    if (!frameEl) return { index: 0, targetElementId: null, rect: null };
    const frameRect = frameEl.getBoundingClientRect();

    if (children.length === 0) {
      return {
        index: 0,
        targetElementId: container.id || null,
        rect: {
          x: frameRect.left,
          y: frameRect.top + frameRect.height / 2,
          width: frameRect.width,
          height: 2,
          horizontal: true,
        },
      };
    }

    const childRects = children.map(c => c.getBoundingClientRect());

    if (horizontal) {
      // Column layout: use Y
      for (let i = 0; i < childRects.length; i++) {
        const midY = (childRects[i].top + childRects[i].bottom) / 2;
        if (clientY < midY) {
          const guideY = i === 0 ? childRects[0].top : (childRects[i - 1].bottom + childRects[i].top) / 2;
          return {
            index: i,
            targetElementId: container.id || null,
            rect: { x: frameRect.left, y: guideY, width: frameRect.width, height: 2, horizontal: true },
          };
        }
      }
      // After last child
      const guideY = childRects[childRects.length - 1].bottom + 4;
      return {
        index: children.length,
        targetElementId: container.id || null,
        rect: { x: frameRect.left, y: guideY, width: frameRect.width, height: 2, horizontal: true },
      };
    } else {
      // Row layout: use X
      for (let i = 0; i < childRects.length; i++) {
        const midX = (childRects[i].left + childRects[i].right) / 2;
        if (clientX < midX) {
          const guideX = i === 0 ? childRects[0].left : (childRects[i - 1].right + childRects[i].left) / 2;
          return {
            index: i,
            targetElementId: container.id || null,
            rect: { x: guideX, y: frameRect.top, width: 2, height: frameRect.height, horizontal: false },
          };
        }
      }
      const guideX = childRects[childRects.length - 1].right + 4;
      return {
        index: children.length,
        targetElementId: container.id || null,
        rect: { x: guideX, y: frameRect.top, width: 2, height: frameRect.height, horizontal: false },
      };
    }
  }

  private showInsertionGuide(parentId: string, slot: { rect: { x: number; y: number; width: number; height: number; horizontal: boolean } | null }): void {
    if (!slot.rect) {
      this.hideInsertionGuide();
      return;
    }

    if (!this.insertionGuide) {
      this.insertionGuide = document.createElement('div');
      this.insertionGuide.className = 'insertion-guide';
      document.body.appendChild(this.insertionGuide);
    }

    const guide = this.insertionGuide;
    guide.style.display = 'block';

    if (slot.rect.horizontal) {
      guide.className = 'insertion-guide horizontal';
      guide.style.left = `${slot.rect.x + 8}px`;
      guide.style.top = `${slot.rect.y - 1}px`;
      guide.style.width = `${slot.rect.width - 16}px`;
      guide.style.height = '2px';
    } else {
      guide.className = 'insertion-guide vertical';
      guide.style.left = `${slot.rect.x - 1}px`;
      guide.style.top = `${slot.rect.y + 8}px`;
      guide.style.width = '2px';
      guide.style.height = `${slot.rect.height - 16}px`;
    }
  }

  private hideInsertionGuide(): void {
    if (this.insertionGuide) {
      this.insertionGuide.style.display = 'none';
    }
  }

  getFrameElement(id: string): HTMLElement | null {
    const comp = this.components.get(id);
    if (!comp) return null;
    return comp.wrapper.querySelector('.component-frame');
  }

  // ── Fast append path (insert_html) ──

  appendElements(componentId: string, targetHtmlId: string | null, newNodes: ElementNode[]): void {
    const comp = this.components.get(componentId);
    if (!comp || newNodes.length === 0) return;

    // Update local rootElements to stay in sync with canvas-store
    if (!targetHtmlId) {
      comp.rootElements.push(...newNodes);
    } else {
      const target = this.findElementByHtmlId(comp.rootElements, targetHtmlId);
      if (target) target.children.push(...newNodes);
    }

    // Find the DOM target inside Shadow DOM
    let parentEl: Element | ShadowRoot = comp.contentDiv;
    if (targetHtmlId) {
      const found = comp.shadow.querySelector(`[id="${targetHtmlId}"]`);
      if (found) parentEl = found;
    }

    // Append new DOM nodes and animate them
    const frag = elementTreeToDOM(newNodes);
    const topLevelElements = Array.from(frag.children);
    parentEl.appendChild(frag);
    for (const el of topLevelElements) {
      el.classList.add('glue-new');
    }

    // Update known IDs and reset hologram resolve timer
    const newIds = this.collectElementIds(newNodes);
    for (const id of newIds) comp.knownElementIds.add(id);
    this.scheduleResolve(comp);
  }

  private findElementByHtmlId(nodes: ElementNode[], htmlId: string): ElementNode | null {
    for (const node of nodes) {
      if (node.attributes?.id === htmlId) return node;
      const found = this.findElementByHtmlId(node.children, htmlId);
      if (found) return found;
    }
    return null;
  }

  // ── Holographic animation helpers ──

  private collectElementIds(nodes: ElementNode[]): Set<string> {
    const ids = new Set<string>();
    const visit = (list: ElementNode[]) => {
      for (const node of list) {
        if (node.tag !== '#text' && node.id) ids.add(node.id);
        visit(node.children);
      }
    };
    visit(nodes);
    return ids;
  }

  private scheduleResolve(comp: RenderedComponent): void {
    if (comp.resolveTimer !== null) clearTimeout(comp.resolveTimer);
    comp.resolveTimer = setTimeout(() => {
      comp.wrapper.classList.remove('holographic');
      comp.resolveTimer = null;
    }, 2500);
  }

  /** Check if two ElementNode trees have the same structure (same IDs in same positions) */
  private sameStructure(a: ElementNode[], b: ElementNode[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].id !== b[i].id || a[i].tag !== b[i].tag) return false;
      if (!this.sameStructure(a[i].children, b[i].children)) return false;
    }
    return true;
  }

  /** Surgically update DOM elements to match new ElementNode data without re-creating them */
  private surgicalUpdate(shadow: ShadowRoot, nodes: ElementNode[]): void {
    for (const node of nodes) {
      if (node.tag === '#text') continue;

      const domEl = shadow.querySelector(`[data-element-id="${node.id}"]`) as HTMLElement;
      if (!domEl) continue;

      // Sync styles
      domEl.removeAttribute('style');
      for (const [prop, val] of Object.entries(node.styles)) {
        domEl.style.setProperty(prop, val);
      }

      // Sync classes
      domEl.className = '';
      for (const cls of node.classes) {
        domEl.classList.add(cls);
      }

      // Sync attributes (except data-element-id)
      const existingAttrs = Array.from(domEl.attributes).map(a => a.name);
      for (const attr of existingAttrs) {
        if (attr === 'data-element-id' || attr === 'style' || attr === 'class') continue;
        domEl.removeAttribute(attr);
      }
      for (const [attr, val] of Object.entries(node.attributes)) {
        domEl.setAttribute(attr, val);
      }

      // Sync text content (only for leaf elements with text)
      if (node.textContent !== undefined && node.children.length === 0) {
        domEl.textContent = node.textContent;
      } else if (node.children.length > 0 && node.children.every(c => c.tag === '#text')) {
        domEl.textContent = node.children.map(c => c.textContent ?? '').join('');
      }

      // Recurse for non-text children
      this.surgicalUpdate(shadow, node.children);
    }
  }
}
