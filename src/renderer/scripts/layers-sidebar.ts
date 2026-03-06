import type { ComponentRenderer } from './component-renderer';
import type { SelectionManager } from './selection-manager';
import type { ElementNode } from '../../shared/canvas-types';

interface LayerEntry {
  id: string;
  name: string;
  rootElements: ElementNode[];
}

// Tags whose content is purely textual — treated as text-type leaves
const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'label', 'a', 'button', 'li', 'td', 'th', 'caption', 'blockquote', 'pre', 'code', 'strong', 'em', 'b', 'i', 'small', 'mark', 'del', 'ins', 'sub', 'sup']);

function isTextNode(node: ElementNode): boolean {
  return node.tag === '#text';
}

/** True if the node has at least one non-text child (expandable) */
function hasExpandableChildren(node: ElementNode): boolean {
  return node.children.some(c => c.tag !== '#text');
}

/** Display name: id > first class > tag */
function nodeName(node: ElementNode): string {
  if (node.tag === '#text') {
    const t = (node.textContent ?? '').trim();
    return t.length > 30 ? t.slice(0, 30) + '…' : t || '(empty)';
  }
  if (node.attributes.id) return node.attributes.id;
  if (node.classes.length > 0) return node.classes[0];
  return node.tag;
}

/** 0 = named (has id), 1 = classed, 2 = tag-only, 3 = text node */
function nodeEmphasis(node: ElementNode): 0 | 1 | 2 | 3 {
  if (node.tag === '#text') return 3;
  if (node.attributes.id) return 0;
  if (node.classes.length > 0) return 1;
  return 2;
}

/** True when the node should show a T icon (text-leaf or pure text element) */
function isTextType(node: ElementNode): boolean {
  if (node.tag === '#text') return true;
  if (TEXT_TAGS.has(node.tag) && !hasExpandableChildren(node)) return true;
  return false;
}

const ICON_FRAME = `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.3"/>
  <line x1="0" y1="4" x2="2.5" y2="4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  <line x1="9.5" y1="4" x2="12" y2="4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  <line x1="4" y1="0" x2="4" y2="2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  <line x1="4" y1="9.5" x2="4" y2="12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
</svg>`;

const ICON_TEXT = `<svg width="10" height="12" viewBox="0 0 10 12" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 2.5h8M5 2.5v7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

const CHEVRON_DOWN = `<svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 3L4 5.5 6.5 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_RIGHT = `<svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M3 1.5L5.5 4 3 6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export class LayersSidebar {
  private listEl: HTMLElement;
  private renderer: ComponentRenderer;
  private selectionManager: SelectionManager;
  private layers: LayerEntry[] = [];
  private selectedComponentIds = new Set<string>();
  private selectedElementIds = new Set<string>();
  private activeComponentId: string | null = null;
  private expandedComponentIds = new Set<string>();
  private expandedElementKeys = new Set<string>(); // `${compId}:${elemId}`

  constructor(renderer: ComponentRenderer, selectionManager: SelectionManager) {
    this.listEl = document.getElementById('layers-list')!;
    this.renderer = renderer;
    this.selectionManager = selectionManager;

    renderer.onCountChange(() => this.syncFromRenderer());
    renderer.onSelectionChange((ids) => {
      this.selectedComponentIds = new Set(ids);
      this.updateSelectionHighlight();
    });

    selectionManager.onSelectionChange((state) => {
      this.activeComponentId = state.activeComponentId;
      this.selectedElementIds = new Set(state.selectedElementIds);
      this.updateSelectionHighlight();
    });
  }

  private syncFromRenderer(): void {
    const bounds = this.renderer.getAllComponentBoundsWithIds();
    this.layers = bounds.map((b) => {
      const data = this.renderer.getComponentData(b.id);
      const comp = this.renderer.getRenderedComponent(b.id);
      return {
        id: b.id,
        name: data?.name ?? 'Component',
        rootElements: comp?.rootElements ?? [],
      };
    });
    this.render();
  }

  private render(): void {
    this.listEl.innerHTML = '';

    if (this.layers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'layer-empty';
      empty.textContent = 'No layers';
      this.listEl.appendChild(empty);
      return;
    }

    for (const layer of [...this.layers].reverse()) {
      this.listEl.appendChild(this.buildComponentRow(layer));
      if (this.expandedComponentIds.has(layer.id)) {
        for (const node of layer.rootElements) {
          this.appendElementRow(node, layer.id, 1);
        }
      }
    }
  }

  private buildComponentRow(layer: LayerEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.dataset.layerId = layer.id;
    if (this.selectedComponentIds.has(layer.id)) row.classList.add('active');

    const hasChildren = layer.rootElements.length > 0;
    const isExpanded = this.expandedComponentIds.has(layer.id);

    const chevron = document.createElement('span');
    chevron.className = 'layer-chevron';
    chevron.innerHTML = isExpanded ? CHEVRON_DOWN : CHEVRON_RIGHT;
    if (!hasChildren) chevron.style.visibility = 'hidden';
    row.appendChild(chevron);

    const icon = document.createElement('span');
    icon.className = 'layer-icon layer-icon--frame';
    icon.innerHTML = ICON_FRAME;
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layer.name;
    row.appendChild(name);

    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.expandedComponentIds.has(layer.id)) {
        this.expandedComponentIds.delete(layer.id);
      } else {
        this.expandedComponentIds.add(layer.id);
      }
      this.render();
    });

    row.addEventListener('click', () => {
      this.selectionManager.exitElementMode();
      this.renderer.select(layer.id, false);
    });

    return row;
  }

  private appendElementRow(node: ElementNode, componentId: string, depth: number): void {
    const elemKey = `${componentId}:${node.id}`;
    const isExpanded = this.expandedElementKeys.has(elemKey);
    const expandable = hasExpandableChildren(node) && !isTextNode(node);
    const emphasis = nodeEmphasis(node);

    const row = document.createElement('div');
    row.className = 'layer-element-row';
    if (emphasis === 0) row.classList.add('layer-element-row--named');
    else if (emphasis === 2) row.classList.add('layer-element-row--anonymous');
    else if (emphasis === 3) row.classList.add('layer-element-row--text');
    row.dataset.elementId = node.id;
    row.dataset.componentId = componentId;
    row.style.paddingLeft = `${6 + depth * 12}px`;

    if (this.activeComponentId === componentId && this.selectedElementIds.has(node.id)) {
      row.classList.add('active');
    }

    // Chevron
    const chevron = document.createElement('span');
    chevron.className = 'layer-chevron';
    if (expandable) {
      chevron.innerHTML = isExpanded ? CHEVRON_DOWN : CHEVRON_RIGHT;
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.expandedElementKeys.has(elemKey)) {
          this.expandedElementKeys.delete(elemKey);
        } else {
          this.expandedElementKeys.add(elemKey);
        }
        this.render();
      });
    } else {
      chevron.style.visibility = 'hidden';
    }
    row.appendChild(chevron);

    // Icon
    const icon = document.createElement('span');
    icon.className = isTextType(node) ? 'layer-icon layer-icon--text' : 'layer-icon layer-icon--frame';
    icon.innerHTML = isTextType(node) ? ICON_TEXT : ICON_FRAME;
    row.appendChild(icon);

    // Name
    const nameEl = document.createElement('span');
    nameEl.className = 'layer-element-name';
    nameEl.textContent = nodeName(node);
    row.appendChild(nameEl);

    // Click selects element (text nodes are not interactive)
    if (!isTextNode(node)) {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.selectionManager.getMode() !== 'element' || this.selectionManager.getActiveComponentId() !== componentId) {
          this.selectionManager.enterElementMode(componentId);
        }
        this.selectionManager.selectElement(node.id, false);
      });
    }

    this.listEl.appendChild(row);

    // Recurse into children if expanded
    if (expandable && isExpanded) {
      for (const child of node.children) {
        this.appendElementRow(child, componentId, depth + 1);
      }
    }
  }

  private updateSelectionHighlight(): void {
    for (const row of this.listEl.querySelectorAll<HTMLElement>('.layer-row')) {
      row.classList.toggle('active', this.selectedComponentIds.has(row.dataset.layerId!));
    }
    for (const row of this.listEl.querySelectorAll<HTMLElement>('.layer-element-row')) {
      const isActive = this.activeComponentId === row.dataset.componentId && this.selectedElementIds.has(row.dataset.elementId!);
      row.classList.toggle('active', isActive);
    }
  }

  clear(): void {
    this.layers = [];
    this.selectedComponentIds.clear();
    this.selectedElementIds.clear();
    this.activeComponentId = null;
    this.expandedComponentIds.clear();
    this.expandedElementKeys.clear();
    this.render();
  }
}
