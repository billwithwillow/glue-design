import type { ElementNode } from './canvas-types';

// ── Counter for generating unique element IDs ──

let nextElementId = 1;

function genId(): string {
  return `el-${nextElementId++}`;
}

// ── Parse inline style string → Record<string, string> ──

function parseStyleString(style: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!style) return result;
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim();
    const val = decl.slice(colon + 1).trim();
    if (prop && val) result[prop] = val;
  }
  return result;
}

// ── Serialize styles Record back to string ──

function serializeStyles(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

// ── Escape HTML special chars ──

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════
// htmlToElementTree — main process only (uses node-html-parser)
// ═══════════════════════════════════════════════════════════

export function htmlToElementTree(html: string): ElementNode[] {
  // Dynamically require node-html-parser (available in main process)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parse, NodeType } = require('node-html-parser');
  const root = parse(html, { comment: false });

  function convert(node: any): ElementNode | null {
    if (node.nodeType === NodeType.TEXT_NODE) {
      const text = node.rawText;
      if (!text.trim()) return null; // skip whitespace-only text
      return {
        id: genId(),
        tag: '#text',
        textContent: text,
        attributes: {},
        classes: [],
        styles: {},
        children: [],
      };
    }

    if (node.nodeType !== NodeType.ELEMENT_NODE) return null;

    const tag: string = node.tagName?.toLowerCase() ?? 'div';
    const rawAttrs: Record<string, string> = node.attributes || {};

    // Separate class and style from other attributes
    const classes = rawAttrs.class ? rawAttrs.class.split(/\s+/).filter(Boolean) : [];
    const styles = rawAttrs.style ? parseStyleString(rawAttrs.style) : {};
    const attributes: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawAttrs)) {
      if (k === 'class' || k === 'style') continue;
      attributes[k] = v;
    }

    const children: ElementNode[] = [];
    for (const child of node.childNodes) {
      const converted = convert(child);
      if (converted) children.push(converted);
    }

    return {
      id: genId(),
      tag,
      attributes,
      classes,
      styles,
      children,
    };
  }

  const result: ElementNode[] = [];
  for (const child of root.childNodes) {
    const converted = convert(child);
    if (converted) result.push(converted);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
// elementTreeToHTML — serialize back to HTML string
// ═══════════════════════════════════════════════════════════

export function elementTreeToHTML(nodes: ElementNode[]): string {
  return nodes.map(serializeNode).join('');
}

function serializeNode(node: ElementNode): string {
  if (node.tag === '#text') {
    return node.textContent ?? '';
  }

  const attrs: string[] = [];

  if (node.classes.length > 0) {
    attrs.push(`class="${escapeHtml(node.classes.join(' '))}"`);
  }

  const styleStr = serializeStyles(node.styles);
  if (styleStr) {
    attrs.push(`style="${escapeHtml(styleStr)}"`);
  }

  for (const [k, v] of Object.entries(node.attributes)) {
    attrs.push(`${k}="${escapeHtml(v)}"`);
  }

  const open = attrs.length > 0 ? `<${node.tag} ${attrs.join(' ')}>` : `<${node.tag}>`;

  // Void elements
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  if (voidTags.has(node.tag)) {
    return open;
  }

  const inner = node.children.map(serializeNode).join('');
  return `${open}${inner}</${node.tag}>`;
}
