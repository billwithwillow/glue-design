import { v4 as uuidv4 } from 'uuid';
import type { CanvasComponent, CanvasPage, CanvasProject, ElementNode, FrameProps } from '../../shared/canvas-types';
import { htmlToElementTree } from '../../shared/element-tree';

export class CanvasStore {
  private project: CanvasProject;
  private nextX = 50;
  private nextY = 50;

  constructor() {
    const pageId = uuidv4();
    this.project = {
      id: uuidv4(),
      name: 'Untitled Project',
      pages: {
        [pageId]: {
          id: pageId,
          name: 'Page 1',
          components: {},
          viewport: { panX: 0, panY: 0, zoom: 1 },
        },
      },
      pageOrder: [pageId],
      activePageId: pageId,
    };
  }

  // ── Active page helper ──

  private getActivePageComponents(): Record<string, CanvasComponent> {
    return this.project.pages[this.project.activePageId].components;
  }

  // ── Component CRUD (scoped to active page) ──

  create(data: { name: string; html: string; css: string; width?: number; height?: number; frameProps?: FrameProps }): CanvasComponent {
    const id = uuidv4();
    const component: CanvasComponent = {
      id,
      name: data.name,
      rootElements: htmlToElementTree(data.html),
      cssRules: data.css,
      width: data.width ?? 400,
      height: data.height ?? 300,
      x: this.nextX,
      y: this.nextY,
      ...(data.frameProps !== undefined && { frameProps: data.frameProps }),
    };

    this.getActivePageComponents()[id] = component;

    this.nextX += 50;
    this.nextY += 50;

    return component;
  }

  update(id: string, updates: Partial<Omit<CanvasComponent, 'id'>> & { html?: string; css?: string }): CanvasComponent | null {
    const components = this.getActivePageComponents();
    const component = components[id];
    if (!component) return null;

    // If html string provided, re-parse to element tree
    if (updates.html !== undefined) {
      component.rootElements = htmlToElementTree(updates.html);
    }

    // If css provided, map to cssRules
    if (updates.css !== undefined) {
      component.cssRules = updates.css;
    }

    // Apply other partial updates (name, width, height, x, y, rootElements, cssRules)
    if (updates.name !== undefined) component.name = updates.name;
    if (updates.width !== undefined) component.width = updates.width;
    if (updates.height !== undefined) component.height = updates.height;
    if (updates.x !== undefined) component.x = updates.x;
    if (updates.y !== undefined) component.y = updates.y;
    if (updates.rootElements !== undefined && updates.html === undefined) {
      component.rootElements = updates.rootElements;
    }
    if (updates.cssRules !== undefined && updates.css === undefined) {
      component.cssRules = updates.cssRules;
    }
    if (updates.frameProps !== undefined) component.frameProps = updates.frameProps;

    return component;
  }

  updatePositions(updates: { id: string; x: number; y: number }[]): void {
    const components = this.getActivePageComponents();
    for (const { id, x, y } of updates) {
      const comp = components[id];
      if (comp) {
        comp.x = x;
        comp.y = y;
      }
    }
  }

  delete(id: string): boolean {
    const components = this.getActivePageComponents();
    if (!components[id]) return false;
    delete components[id];
    return true;
  }

  get(id: string): CanvasComponent | null {
    return this.getActivePageComponents()[id] ?? null;
  }

  list(): CanvasComponent[] {
    return Object.values(this.getActivePageComponents());
  }

  clear(): void {
    const page = this.project.pages[this.project.activePageId];
    page.components = {};
    this.nextX = 50;
    this.nextY = 50;
  }

  // ── Page management ──

  createPage(name: string): CanvasPage {
    const id = uuidv4();
    const page: CanvasPage = {
      id,
      name,
      components: {},
      viewport: { panX: 0, panY: 0, zoom: 1 },
    };
    this.project.pages[id] = page;
    this.project.pageOrder.push(id);
    return page;
  }

  listPages(): { id: string; name: string }[] {
    return this.project.pageOrder.map((id) => ({
      id,
      name: this.project.pages[id].name,
    }));
  }

  getActivePage(): CanvasPage {
    return this.project.pages[this.project.activePageId];
  }

  setActivePage(id: string): boolean {
    if (!this.project.pages[id]) return false;
    this.project.activePageId = id;
    this.nextX = 50;
    this.nextY = 50;
    return true;
  }

  getProject(): CanvasProject {
    return this.project;
  }

  // ── Element-level updates ──

  updateElement(
    componentId: string,
    elementId: string,
    updates: { styles?: Record<string, string>; classes?: string[]; textContent?: string; attributes?: Record<string, string> }
  ): CanvasComponent | null {
    const component = this.get(componentId);
    if (!component) return null;

    const element = this.findElementInTree(component.rootElements, elementId);
    if (!element) return null;

    if (updates.styles) {
      for (const [key, value] of Object.entries(updates.styles)) {
        if (value === '') {
          delete element.styles[key];
        } else {
          element.styles[key] = value;
        }
      }
    }

    if (updates.classes !== undefined) {
      element.classes = updates.classes;
    }

    if (updates.textContent !== undefined) {
      // Update #text children in-place to preserve tree structure (enables surgical DOM updates).
      // If the element has #text children, update them. Otherwise, set textContent directly.
      const textChildren = element.children.filter(c => c.tag === '#text');
      if (textChildren.length > 0) {
        // Set the first text child to the new content, remove extras
        textChildren[0].textContent = updates.textContent;
        if (textChildren.length > 1) {
          element.children = element.children.filter(
            (c) => c.tag !== '#text' || c === textChildren[0]
          );
        }
      } else if (element.children.length === 0) {
        // Leaf element with no children — set directly
        element.textContent = updates.textContent;
      } else {
        // Has non-text children — set textContent and clear children
        element.textContent = updates.textContent;
        element.children = [];
      }
    }

    if (updates.attributes) {
      for (const [key, value] of Object.entries(updates.attributes)) {
        if (value === '') {
          delete element.attributes[key];
        } else {
          element.attributes[key] = value;
        }
      }
    }

    return component;
  }

  findElementInTree(nodes: ElementNode[], targetId: string): ElementNode | null {
    for (const node of nodes) {
      if (node.id === targetId) return node;
      const found = this.findElementInTree(node.children, targetId);
      if (found) return found;
    }
    return null;
  }

  insertHTMLChildren(
    componentId: string,
    targetHtmlId: string | null,
    html: string
  ): CanvasComponent | null {
    const component = this.get(componentId);
    if (!component) return null;

    const newNodes = htmlToElementTree(html);
    if (newNodes.length === 0) return component;

    if (!targetHtmlId) {
      component.rootElements.push(...newNodes);
    } else {
      const target = this.findElementByHtmlId(component.rootElements, targetHtmlId);
      if (!target) return null;
      target.children.push(...newNodes);
    }

    return component;
  }

  replaceElementChildren(
    componentId: string,
    targetHtmlId: string | null,
    html: string
  ): CanvasComponent | null {
    const component = this.get(componentId);
    if (!component) return null;

    const newNodes = htmlToElementTree(html);

    if (!targetHtmlId) {
      component.rootElements = newNodes;
    } else {
      const target = this.findElementByHtmlId(component.rootElements, targetHtmlId);
      if (!target) return null;
      target.children = newNodes;
    }

    return component;
  }

  deleteElement(componentId: string, elementId: string): CanvasComponent | null {
    const component = this.get(componentId);
    if (!component) return null;

    const result = this.findParentInTree(component.rootElements, elementId, null);
    if (!result) return null;

    const { parent, index } = result;
    if (parent === null) {
      component.rootElements.splice(index, 1);
    } else {
      parent.children.splice(index, 1);
    }

    return component;
  }

  private findParentInTree(
    nodes: ElementNode[],
    targetId: string,
    parent: ElementNode | null
  ): { parent: ElementNode | null; index: number } | null {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === targetId) return { parent, index: i };
      const found = this.findParentInTree(nodes[i].children, targetId, nodes[i]);
      if (found) return found;
    }
    return null;
  }

  private findElementByHtmlId(nodes: ElementNode[], htmlId: string): ElementNode | null {
    for (const node of nodes) {
      if (node.attributes?.id === htmlId) return node;
      const found = this.findElementByHtmlId(node.children, htmlId);
      if (found) return found;
    }
    return null;
  }
}
