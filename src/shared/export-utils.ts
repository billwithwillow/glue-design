import type { CanvasComponent, ElementNode, FrameProps } from './canvas-types';

// ── CSS property → camelCase React style key ──

function cssPropertyToCamelCase(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ── Build React style={{ }} object literal from css Record ──

function stylesObjectLiteral(styles: Record<string, string>): string {
  const entries = Object.entries(styles).filter(([, v]) => v !== '');
  if (entries.length === 0) return '';
  const pairs = entries.map(([k, v]) => `${cssPropertyToCamelCase(k)}: '${v}'`).join(', ');
  return `{{ ${pairs} }}`;
}

// ── Void tags that self-close ──

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// ── Derive PascalCase component name ──

function toPascalCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Component';
}

// ── Recursively emit JSX for an ElementNode ──

function emitJSX(node: ElementNode, indent: number, componentMap?: Record<string, { name: string }>): string {
  const pad = '  '.repeat(indent);

  if (node.tag === '#text') {
    return `${pad}${node.textContent ?? ''}`;
  }

  // Component ref → emit as <ComponentName />
  if (node.tag === '__component_ref__' && componentMap) {
    const refId = node.attributes['data-component-ref'];
    const refInfo = refId ? componentMap[refId] : undefined;
    if (refInfo) {
      const compName = toPascalCase(refInfo.name);
      return `${pad}<${compName} />`;
    }
    return `${pad}{/* nested component ref */}`;
  }

  const attrs: string[] = [];

  // className
  if (node.classes.length > 0) {
    attrs.push(`className="${node.classes.join(' ')}"`);
  }

  // style
  const styleStr = stylesObjectLiteral(node.styles);
  if (styleStr) {
    attrs.push(`style=${styleStr}`);
  }

  // other attributes
  for (const [k, v] of Object.entries(node.attributes)) {
    if (k === 'data-element-id') continue; // internal id, skip
    if (k === 'data-component-ref') continue; // internal ref, skip
    const jsxKey = k === 'for' ? 'htmlFor' : k === 'class' ? 'className' : k;
    attrs.push(`${jsxKey}="${v}"`);
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  const tag = node.tag;

  if (VOID_TAGS.has(tag)) {
    return `${pad}<${tag}${attrStr} />`;
  }

  // Filter real children (skip empty text nodes)
  const children = node.children.filter(
    (c) => !(c.tag === '#text' && (c.textContent ?? '').trim() === '')
  );

  // Text-only leaf: inline
  if (children.length === 1 && children[0].tag === '#text') {
    return `${pad}<${tag}${attrStr}>${children[0].textContent ?? ''}</${tag}>`;
  }

  if (node.textContent !== undefined) {
    return `${pad}<${tag}${attrStr}>${node.textContent}</${tag}>`;
  }

  if (children.length === 0) {
    return `${pad}<${tag}${attrStr} />`;
  }

  const innerLines = children.map((c) => emitJSX(c, indent + 1, componentMap)).join('\n');
  return `${pad}<${tag}${attrStr}>\n${innerLines}\n${pad}</${tag}>`;
}

// ── Build outer wrapper style from FrameProps ──

function framePropsToStyle(fp: FrameProps | undefined): Record<string, string> {
  const styles: Record<string, string> = {
    width: '100%',
    height: '100%',
  };
  if (fp?.fill) styles.background = fp.fill;
  if (fp?.cornerRadius !== undefined) styles.borderRadius = `${fp.cornerRadius}px`;
  if (fp?.border && fp.border !== 'none') styles.border = fp.border;
  if (fp?.shadow && fp.shadow !== '' && fp.shadow !== 'none') styles.boxShadow = fp.shadow;
  if (fp?.clipContent === false) styles.overflow = 'visible';
  else styles.overflow = 'hidden';
  return styles;
}

// ── Public API ──

export interface ExportResult {
  jsx: string;
  css: string;
}

export function componentToReact(comp: CanvasComponent, componentMap?: Record<string, { name: string }>): ExportResult {
  const componentName = toPascalCase(comp.name);
  const outerStyle = framePropsToStyle(comp.frameProps);
  const outerStyleStr = stylesObjectLiteral(outerStyle);

  const innerLines = comp.rootElements
    .map((node) => emitJSX(node, 2, componentMap))
    .join('\n');

  // Collect import statements for nested component refs
  const imports: string[] = [`import React from 'react';`];
  if (componentMap) {
    const referencedIds = collectComponentRefs(comp.rootElements);
    for (const refId of referencedIds) {
      const refInfo = componentMap[refId];
      if (refInfo) {
        const refName = toPascalCase(refInfo.name);
        imports.push(`import ${refName} from './${refName}';`);
      }
    }
  }

  const jsx = `${imports.join('\n')}

function ${componentName}() {
  return (
    <div style=${outerStyleStr}>
${innerLines}
    </div>
  );
}

export default ${componentName};`;

  return { jsx, css: comp.cssRules };
}

/** Collect all component ref IDs from an element tree */
function collectComponentRefs(nodes: ElementNode[]): string[] {
  const refs: string[] = [];
  for (const node of nodes) {
    if (node.tag === '__component_ref__') {
      const refId = node.attributes['data-component-ref'];
      if (refId) refs.push(refId);
    }
    refs.push(...collectComponentRefs(node.children));
  }
  return refs;
}
