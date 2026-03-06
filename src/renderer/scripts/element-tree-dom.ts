import type { ElementNode } from '../../shared/canvas-types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Render ElementNode[] → DOM DocumentFragment (browser-only).
 * Sets data-element-id on every rendered element.
 * Tracks SVG context so child elements are created with the correct namespace.
 */
export function elementTreeToDOM(nodes: ElementNode[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    frag.appendChild(createDOMNode(node, false));
  }
  return frag;
}

function createDOMNode(node: ElementNode, inSvg: boolean): Node {
  if (node.tag === '#text') {
    return document.createTextNode(node.textContent ?? '');
  }

  // Component ref placeholder — rendered as a div that the component renderer will fill
  if (node.tag === '__component_ref__') {
    const placeholder = document.createElement('div');
    placeholder.setAttribute('data-component-ref', node.attributes['data-component-ref'] ?? '');
    placeholder.setAttribute('data-element-id', node.id);
    return placeholder;
  }

  const enterSvg = inSvg || node.tag === 'svg';
  const el = enterSvg
    ? document.createElementNS(SVG_NS, node.tag)
    : document.createElement(node.tag);

  el.setAttribute('data-element-id', node.id);

  for (const cls of node.classes) {
    el.classList.add(cls);
  }

  for (const [prop, val] of Object.entries(node.styles)) {
    (el as HTMLElement).style.setProperty(prop, val);
  }

  for (const [attr, val] of Object.entries(node.attributes)) {
    el.setAttribute(attr, val);
  }

  for (const child of node.children) {
    el.appendChild(createDOMNode(child, enterSvg));
  }

  // Fallback: if element has textContent but no children, set it directly
  if (node.textContent !== undefined && node.children.length === 0) {
    el.textContent = node.textContent;
  }

  return el;
}
