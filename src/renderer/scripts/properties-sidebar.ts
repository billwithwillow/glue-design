import type { ElementNode, FrameProps } from '../../shared/canvas-types';

interface StyleField {
  label: string;
  shortLabel?: string;
  property: string;
  type: 'text' | 'number' | 'color';
  unit?: string;
  scrub?: boolean;
}

interface SectionConfig {
  collapsible?: boolean;
  defaultOpen?: boolean;
  icon?: string;
}

const DIMENSION_FIELDS: StyleField[] = [
  { label: 'Width', shortLabel: 'W', property: 'width', type: 'text', scrub: true },
  { label: 'Height', shortLabel: 'H', property: 'height', type: 'text', scrub: true },
];

const TYPOGRAPHY_FIELDS: StyleField[] = [
  { label: 'Size', property: 'font-size', type: 'text', scrub: true },
  { label: 'Weight', property: 'font-weight', type: 'text', scrub: true },
  { label: 'Color', property: 'color', type: 'color' },
];

const BORDER_FIELDS: StyleField[] = [
  { label: 'Width', property: 'border-width', type: 'text', scrub: true },
  { label: 'Color', property: 'border-color', type: 'color' },
];

const BACKGROUND_FIELDS: StyleField[] = [
  { label: 'Color', property: 'background-color', type: 'color' },
];

const RADIUS_SNAP_POINTS = [0, 2, 4, 8, 12, 16, 24, 32, 9999];

export class PropertiesSidebar {
  private container: HTMLElement;
  private content: HTMLElement;
  private viewport: HTMLElement;

  private componentId: string | null = null;
  private elements: ElementNode[] = [];
  private frameProps: FrameProps = {};

  constructor() {
    this.container = document.getElementById('properties-sidebar')!;
    this.content = document.getElementById('sidebar-content')!;
    this.viewport = document.getElementById('canvas-viewport')!;
  }

  update(componentId: string, elements: ElementNode[]): void {
    this.componentId = componentId;
    this.elements = elements;
    this.render();
    this.show();
  }

  showComponentPanel(componentId: string, frameProps?: FrameProps): void {
    this.componentId = componentId;
    this.elements = [];
    this.frameProps = frameProps ?? {};
    this.renderComponentPanel();
    this.show();
  }

  show(): void {
    this.container.classList.remove('hidden');
    this.viewport.classList.add('sidebar-open');
  }

  hide(): void {
    this.container.classList.add('hidden');
    this.viewport.classList.remove('sidebar-open');
    this.componentId = null;
    this.elements = [];
    this.frameProps = {};
  }

  private renderComponentPanel(): void {
    this.content.innerHTML = '';

    // ── Frame Props section ──
    this.renderFramePropsSection();

    // ── Export section ──
    const section = document.createElement('div');
    section.className = 'sidebar-section';

    const header = document.createElement('div');
    header.className = 'sidebar-section-header';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'Export';
    header.appendChild(titleSpan);
    section.appendChild(header);

    const body = document.createElement('div');
    body.className = 'sidebar-section-body';

    const row = document.createElement('div');
    row.className = 'sidebar-export-row';

    const reactBtn = document.createElement('button');
    reactBtn.className = 'sidebar-export-btn';
    reactBtn.textContent = 'Copy as React';
    reactBtn.addEventListener('click', () => this.exportAndCopy('react', reactBtn));

    const htmlBtn = document.createElement('button');
    htmlBtn.className = 'sidebar-export-btn';
    htmlBtn.textContent = 'Copy as HTML';
    htmlBtn.addEventListener('click', () => this.exportAndCopy('html', htmlBtn));

    const screenshotBtn = document.createElement('button');
    screenshotBtn.className = 'sidebar-export-btn sidebar-export-btn--full';
    screenshotBtn.textContent = 'Copy Screenshot';
    screenshotBtn.addEventListener('click', () => this.copyScreenshot(screenshotBtn));

    row.appendChild(reactBtn);
    row.appendChild(htmlBtn);
    body.appendChild(row);

    const screenshotRow = document.createElement('div');
    screenshotRow.className = 'sidebar-export-row';
    screenshotRow.appendChild(screenshotBtn);
    body.appendChild(screenshotRow);
    section.appendChild(body);
    this.content.appendChild(section);
  }

  private renderFramePropsSection(): void {
    const fp = this.frameProps;

    // Fill
    this.addSection('Fill', () => {
      const wrapper = document.createElement('div');
      const fillField: StyleField = { label: 'Color', property: 'fill', type: 'color' };
      const input = this.createInput(fillField, fp.fill ?? 'white', (value) => {
        this.commitFrameUpdate({ fill: value });
      });
      wrapper.appendChild(input);
      return wrapper;
    }, { collapsible: true, defaultOpen: true });

    // Corner Radius
    this.addSection('Corner Radius', () => {
      const wrapper = document.createElement('div');
      const currentRadius = fp.cornerRadius ?? 12;
      const radiusValue = currentRadius >= 9999 ? '50%' : `${currentRadius}px`;
      const radiusRow = this.createRadiusWidget(radiusValue, (newValue) => {
        let numVal: number;
        if (newValue === '50%') {
          numVal = 9999;
        } else {
          numVal = parseFloat(newValue) || 0;
        }
        this.commitFrameUpdate({ cornerRadius: numVal });
      });
      wrapper.appendChild(radiusRow);
      return wrapper;
    }, { collapsible: true, defaultOpen: true });

    // Border
    this.addSection('Border', () => {
      const wrapper = document.createElement('div');
      const input = this.createInput(
        { label: 'Border', property: 'border', type: 'text' },
        fp.border ?? '1.5px solid #e5e5e5',
        (value) => { this.commitFrameUpdate({ border: value }); }
      );
      wrapper.appendChild(input);
      return wrapper;
    }, { collapsible: true, defaultOpen: false });

    // Shadow
    this.addSection('Shadow', () => {
      const wrapper = document.createElement('div');
      const input = this.createInput(
        { label: 'Shadow', property: 'shadow', type: 'text' },
        fp.shadow ?? '',
        (value) => { this.commitFrameUpdate({ shadow: value }); }
      );
      wrapper.appendChild(input);
      return wrapper;
    }, { collapsible: true, defaultOpen: false });

    // Clip Content
    this.addSection('Clip Content', () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'sidebar-clip-row';

      const label = document.createElement('label');
      label.className = 'sidebar-clip-label';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'sidebar-clip-checkbox';
      checkbox.checked = fp.clipContent !== false; // default true

      const text = document.createElement('span');
      text.textContent = 'Clip overflow';

      checkbox.addEventListener('change', () => {
        this.commitFrameUpdate({ clipContent: checkbox.checked });
      });

      label.appendChild(checkbox);
      label.appendChild(text);
      wrapper.appendChild(label);
      return wrapper;
    }, { collapsible: false });
  }

  private commitFrameUpdate(partial: Partial<FrameProps>): void {
    if (!this.componentId) return;
    const api = (window as any).canvasAPI;
    if (!api) return;

    this.frameProps = { ...this.frameProps, ...partial };
    api.canvas.updateFrameProps(this.componentId, partial);
  }

  private exportAndCopy(format: 'react' | 'html', btn: HTMLButtonElement): void {
    if (!this.componentId) return;
    const api = (window as any).canvasAPI;
    if (!api) return;

    api.canvas.exportComponent(this.componentId, format).then((result: any) => {
      if (result?.error) return;
      const text = format === 'react'
        ? (result.css?.trim() ? `${result.jsx}\n\n/* CSS */\n${result.css}` : result.jsx)
        : (result.css?.trim() ? `<style>\n${result.css}\n</style>\n\n${result.html}` : result.html);

      navigator.clipboard.writeText(text ?? '').then(() => {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        btn.disabled = true;
        setTimeout(() => {
          btn.textContent = original;
          btn.disabled = false;
        }, 1500);
      });
    });
  }

  private copyScreenshot(btn: HTMLButtonElement): void {
    if (!this.componentId) return;
    const api = (window as any).canvasAPI;
    if (!api) return;

    const original = btn.textContent;
    btn.textContent = 'Capturing…';
    btn.disabled = true;

    api.canvas.captureComponent(this.componentId).then((result: { ok: boolean }) => {
      btn.textContent = result.ok ? 'Copied!' : 'Failed';
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1500);
    });
  }

  private render(): void {
    this.content.innerHTML = '';

    if (this.elements.length === 0) return;

    const isMulti = this.elements.length > 1;

    // Element info section
    this.addSection('Element', () => {
      const info = document.createElement('div');
      info.className = 'sidebar-info';

      if (isMulti) {
        info.textContent = `${this.elements.length} elements selected`;
      } else {
        const el = this.elements[0];
        const tagLabel = document.createElement('div');
        tagLabel.className = 'sidebar-info-row';
        tagLabel.innerHTML = `<span class="sidebar-info-label">Tag</span><span class="sidebar-info-value">&lt;${el.tag}&gt;</span>`;
        info.appendChild(tagLabel);

        const idLabel = document.createElement('div');
        idLabel.className = 'sidebar-info-row';
        idLabel.innerHTML = `<span class="sidebar-info-label">ID</span><span class="sidebar-info-value">${el.id}</span>`;
        info.appendChild(idLabel);
      }

      return info;
    }, {});

    // Text content section (only if elements have text)
    const hasText = this.elements.some(
      (el) => el.textContent !== undefined || (el.children.length > 0 && el.children.every(c => c.tag === '#text'))
    );

    if (hasText) {
      this.addSection('Text', () => {
        const wrapper = document.createElement('div');
        const textValue = this.getSharedValue((el) => {
          if (el.textContent !== undefined) return el.textContent;
          const textChildren = el.children.filter(c => c.tag === '#text');
          return textChildren.map(c => c.textContent ?? '').join('');
        });

        const input = this.createInput({ label: 'Content', property: '', type: 'text' }, textValue, (value) => {
          this.commitUpdate({ textContent: value });
        });
        wrapper.appendChild(input);
        return wrapper;
      }, { collapsible: true, defaultOpen: true, icon: 'T' });
    }

    // Dimensions — compact 2-column grid, collapsed by default
    this.addStyleSection('Dimensions', DIMENSION_FIELDS, true, {
      collapsible: true,
      defaultOpen: false,
    });

    // Typography
    this.addStyleSection('Typography', TYPOGRAPHY_FIELDS, true, {
      collapsible: true,
      defaultOpen: true,
      icon: 'T',
    });

    // Border — radius gets its own bow-and-arrow widget
    this.addSection('Border', () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'sidebar-fields-grid';

      for (const field of BORDER_FIELDS) {
        const value = this.getSharedValue((el) => el.styles[field.property] ?? '');
        const input = this.createInput(field, value, (newValue) => {
          this.commitUpdate({ styles: { [field.property]: newValue } });
        });
        wrapper.appendChild(input);
      }

      // Radius bow-and-arrow widget (full-width row)
      const radiusValue = this.getSharedValue((el) => el.styles['border-radius'] ?? '');
      const radiusRow = this.createRadiusWidget(radiusValue, (newValue) => {
        this.commitUpdate({ styles: { 'border-radius': newValue } });
      });
      wrapper.appendChild(radiusRow);

      return wrapper;
    }, { collapsible: true, defaultOpen: true });

    // Background
    this.addStyleSection('Background', BACKGROUND_FIELDS, false, {
      collapsible: true,
      defaultOpen: true,
    });
  }

  private addSection(title: string, contentFn: () => HTMLElement, config: SectionConfig = {}): void {
    const section = document.createElement('div');
    section.className = 'sidebar-section';

    const header = document.createElement('div');
    header.className = 'sidebar-section-header';

    if (config.collapsible) {
      header.classList.add('sidebar-section-toggle');
    }

    const headerLeft = document.createElement('span');
    headerLeft.className = 'sidebar-section-header-left';

    if (config.icon) {
      const icon = document.createElement('span');
      icon.className = 'sidebar-section-icon';
      icon.textContent = config.icon;
      headerLeft.appendChild(icon);
    }

    const titleSpan = document.createElement('span');
    titleSpan.textContent = title;
    headerLeft.appendChild(titleSpan);

    header.appendChild(headerLeft);

    const body = document.createElement('div');
    body.className = 'sidebar-section-body';
    body.appendChild(contentFn());

    if (config.collapsible) {
      const chevron = document.createElement('span');
      chevron.className = 'sidebar-chevron';
      chevron.textContent = '▾';
      header.appendChild(chevron);

      const isOpen = config.defaultOpen !== false;
      if (!isOpen) {
        body.classList.add('collapsed');
        chevron.classList.add('closed');
      }

      header.addEventListener('click', () => {
        const collapsed = body.classList.toggle('collapsed');
        chevron.classList.toggle('closed', collapsed);
      });
    }

    section.appendChild(header);
    section.appendChild(body);
    this.content.appendChild(section);
  }

  private addStyleSection(title: string, fields: StyleField[], useGrid: boolean, config: SectionConfig = {}): void {
    this.addSection(title, () => {
      const wrapper = document.createElement('div');
      if (useGrid) wrapper.className = 'sidebar-fields-grid';

      for (const field of fields) {
        const value = this.getSharedValue((el) => el.styles[field.property] ?? '');
        const input = this.createInput(field, value, (newValue) => {
          this.commitUpdate({ styles: { [field.property]: newValue } });
        });
        wrapper.appendChild(input);
      }

      return wrapper;
    }, config);
  }

  private createRadiusWidget(currentValue: string, onChange: (v: string) => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sidebar-field sidebar-radius-row';

    const labelEl = document.createElement('label');
    labelEl.className = 'sidebar-field-label';
    labelEl.textContent = 'R';
    row.appendChild(labelEl);

    // Parse current value
    const parseRadius = (v: string): number => {
      if (!v || v === 'Mixed') return 0;
      if (v === '50%') return 9999;
      return parseFloat(v) || 0;
    };

    const formatRadius = (r: number): string => {
      if (r >= 9999) return '50%';
      return `${r}px`;
    };

    let currentRadius = parseRadius(currentValue);

    // SVG widget
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '52');
    svg.setAttribute('height', '52');
    svg.setAttribute('viewBox', '0 0 52 52');
    svg.classList.add('radius-widget');

    // Corner lines (top side and left side meeting at top-left)
    const lineTop = document.createElementNS(svgNS, 'line');
    lineTop.setAttribute('x1', '44'); lineTop.setAttribute('y1', '8');
    lineTop.setAttribute('x2', '8'); lineTop.setAttribute('y2', '8');
    lineTop.classList.add('radius-corner-line');

    const lineLeft = document.createElementNS(svgNS, 'line');
    lineLeft.setAttribute('x1', '8'); lineLeft.setAttribute('y1', '8');
    lineLeft.setAttribute('x2', '8'); lineLeft.setAttribute('y2', '44');
    lineLeft.classList.add('radius-corner-line');

    const arcPath = document.createElementNS(svgNS, 'path');
    arcPath.classList.add('radius-arc-path');

    const handle = document.createElementNS(svgNS, 'circle');
    handle.setAttribute('r', '4');
    handle.classList.add('radius-handle');

    svg.appendChild(lineTop);
    svg.appendChild(lineLeft);
    svg.appendChild(arcPath);
    svg.appendChild(handle);

    // Readout
    const readout = document.createElement('span');
    readout.className = 'radius-readout';

    const updateWidget = (r: number) => {
      const maxR = 36; // max visual radius in SVG space (corner is at 8,8, space is 36px)
      const displayR = r >= 9999 ? maxR : Math.min(r, maxR);
      const cx = 8; const cy = 8; // corner point

      // Arc from (8 + displayR, 8) around to (8, 8 + displayR)
      const x1 = cx + displayR;
      const y1 = cy;
      const x2 = cx;
      const y2 = cy + displayR;

      if (displayR < 1) {
        arcPath.setAttribute('d', '');
        handle.setAttribute('cx', String(cx + 2));
        handle.setAttribute('cy', String(cy + 2));
      } else {
        arcPath.setAttribute('d', `M ${x1} ${y1} A ${displayR} ${displayR} 0 0 0 ${x2} ${y2}`);
        // Handle at arc midpoint (45deg from corner)
        const mid = displayR * (1 - Math.SQRT2 / 2);
        handle.setAttribute('cx', String(cx + displayR - mid));
        handle.setAttribute('cy', String(cy + displayR - mid));
      }

      readout.textContent = r >= 9999 ? 'pill' : `${r}px`;
    };

    updateWidget(currentRadius);

    // Drag on handle — pointer position maps directly onto SVG space
    let dragging = false;

    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      dragging = true;
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;

      const rect = svg.getBoundingClientRect();
      const scaleX = 52 / rect.width;
      const scaleY = 52 / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;

      // Project pointer onto the diagonal from corner (8,8)
      // Handle lives at (8 + r*√2/2, 8 + r*√2/2), so r = ((px-8)+(py-8))/√2
      const diag = ((px - 8) + (py - 8)) / Math.SQRT2;
      const maxR = 36;
      const rawRadius = Math.max(0, Math.min(maxR, diag));

      // Snap
      let snapped: number = rawRadius;
      let didSnap = false;
      for (const snap of RADIUS_SNAP_POINTS) {
        const snapDisplay = snap >= 9999 ? maxR : snap;
        if (Math.abs(rawRadius - snapDisplay) < 3) {
          snapped = snap;
          didSnap = true;
          break;
        }
      }
      if (!didSnap) snapped = Math.round(rawRadius);

      if (snapped !== currentRadius) {
        currentRadius = snapped;
        updateWidget(currentRadius);
        onChange(formatRadius(currentRadius));

        if (didSnap) {
          arcPath.classList.add('snap-flash');
          handle.classList.add('snap-flash');
          setTimeout(() => {
            arcPath.classList.remove('snap-flash');
            handle.classList.remove('snap-flash');
          }, 300);
        }
      }
    });

    handle.addEventListener('pointerup', () => {
      dragging = false;
    });

    const widgetWrapper = document.createElement('div');
    widgetWrapper.className = 'radius-widget-wrapper';
    widgetWrapper.appendChild(svg);
    widgetWrapper.appendChild(readout);
    row.appendChild(widgetWrapper);

    return row;
  }

  private getSharedValue(getter: (el: ElementNode) => string): string {
    if (this.elements.length === 0) return '';
    const first = getter(this.elements[0]);
    for (let i = 1; i < this.elements.length; i++) {
      if (getter(this.elements[i]) !== first) return 'Mixed';
    }
    return first;
  }

  private createInput(
    field: StyleField | { label: string; property: string; type: string; shortLabel?: string; scrub?: boolean },
    value: string,
    onChange: (value: string) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sidebar-field';

    const type = field.type as string;
    const isScrub = (field as StyleField).scrub === true;
    const displayLabel = (field as StyleField).shortLabel ?? field.label;

    const labelEl = document.createElement('label');
    labelEl.className = 'sidebar-field-label';
    if (isScrub) labelEl.classList.add('sidebar-scrub-label');
    labelEl.textContent = displayLabel;
    row.appendChild(labelEl);

    if (type === 'color') {
      const colorWrapper = document.createElement('div');
      colorWrapper.className = 'sidebar-color-field';

      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.className = 'sidebar-color-swatch';
      swatch.value = this.normalizeColor(value) || '#000000';

      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'sidebar-field-input sidebar-color-text';
      textInput.value = value === 'Mixed' ? '' : value;
      if (value === 'Mixed') textInput.placeholder = 'Mixed';

      const colorHandler = () => {
        textInput.value = swatch.value;
        onChange(swatch.value);
      };
      swatch.addEventListener('input', colorHandler);
      swatch.addEventListener('change', colorHandler);

      const commitText = () => onChange(textInput.value);
      textInput.addEventListener('change', commitText);
      textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { textInput.blur(); commitText(); }
        e.stopPropagation();
      });

      colorWrapper.appendChild(swatch);
      colorWrapper.appendChild(textInput);
      row.appendChild(colorWrapper);
    } else {
      const wrapper = document.createElement('div');
      wrapper.className = 'sidebar-scrub-wrapper';

      const input = document.createElement('input');
      input.className = 'sidebar-field-input';
      if (isScrub) input.classList.add('sidebar-scrub-input');
      input.type = 'text';
      input.value = value === 'Mixed' ? '' : value;
      if (value === 'Mixed') input.placeholder = 'Mixed';

      const commit = () => onChange(input.value);
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); commit(); }
        e.stopPropagation();
      });

      wrapper.appendChild(input);
      row.appendChild(wrapper);

      if (isScrub) {
        this.attachScrub(labelEl, input, onChange);
        this.attachScrub(input, input, onChange);
      }
    }

    return row;
  }

  private attachScrub(target: HTMLElement, input: HTMLInputElement, onChange: (v: string) => void): void {
    let scrubbing = false;

    target.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Only prevent default on label, not the input itself (so click-to-type still works after scrub)
      const isInput = target === input;
      let moved = false;

      const startValue = parseFloat(input.value) || 0;
      const unit = input.value.replace(/[\d.\-+]/g, '') || 'px';
      let accumulated = 0;
      scrubbing = true;

      const onMove = (me: MouseEvent) => {
        if (!moved) {
          moved = true;
          e.preventDefault();
          if (isInput) input.blur();
          document.body.style.cursor = 'ns-resize';
          document.body.style.userSelect = 'none';
        }
        let sensitivity = 1;
        if (me.shiftKey) sensitivity = 10;
        if (me.altKey) sensitivity = 0.1;
        accumulated += -me.movementY * sensitivity;
        const newVal = Math.round((startValue + accumulated) * 10) / 10;
        input.value = `${newVal}${unit}`;
        onChange(input.value);
      };

      const onUp = () => {
        scrubbing = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      if (!isInput) e.preventDefault();
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  private normalizeColor(value: string): string {
    if (!value || value === 'Mixed') return '';
    if (value.startsWith('#')) return value.length <= 7 ? value : value.slice(0, 7);
    const temp = document.createElement('div');
    temp.style.color = value;
    document.body.appendChild(temp);
    const computed = getComputedStyle(temp).color;
    temp.remove();
    const match = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const hex = (n: string) => parseInt(n).toString(16).padStart(2, '0');
      return `#${hex(match[1])}${hex(match[2])}${hex(match[3])}`;
    }
    return value;
  }

  private commitUpdate(updates: {
    styles?: Record<string, string>;
    textContent?: string;
  }): void {
    if (!this.componentId) return;

    const api = (window as any).canvasAPI;
    if (!api) return;

    for (const el of this.elements) {
      api.canvas.updateElement(this.componentId, el.id, updates);
    }
  }
}
