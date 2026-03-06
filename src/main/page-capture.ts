import { BrowserWindow } from 'electron';

export interface CaptureOptions {
  url: string;
  selector?: string;
  waitFor?: string;
  waitMs?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  includeScreenshot?: boolean;
}

export interface CaptureResult {
  html: string;
  css: string;
  computedStyles: string;
  title: string;
  screenshot?: string;
  viewportWidth: number;
  viewportHeight: number;
  contentHeight: number;
}

function buildCaptureScript(selector?: string): string {
  const selectorLiteral = selector ? JSON.stringify(selector) : 'null';
  return `(function() {
  var selector = ${selectorLiteral};

  // 1. Find target element
  var target;
  if (selector) {
    target = document.querySelector(selector);
  } else {
    // Skip hidden elements (Next.js inserts hidden divs for internal CSS)
    var children = document.body.children;
    target = null;
    for (var i = 0; i < children.length; i++) {
      if (!children[i].hasAttribute('hidden') && window.getComputedStyle(children[i]).display !== 'none') {
        target = children[i];
        break;
      }
    }
    if (!target) target = document.body.children[0];
  }
  if (!target) return { error: 'Element not found' };

  // 1b. Resolve relative URLs to absolute so images load from the dev server
  var origin = window.location.origin;
  var allMedia = target.querySelectorAll('[src], [srcset], [poster]');
  for (var i = 0; i < allMedia.length; i++) {
    var el = allMedia[i];
    if (el.hasAttribute('src') && el.getAttribute('src').indexOf('://') === -1 && el.getAttribute('src').indexOf('data:') !== 0) {
      el.setAttribute('src', origin + (el.getAttribute('src').charAt(0) === '/' ? '' : '/') + el.getAttribute('src'));
    }
    if (el.hasAttribute('srcset')) {
      var parts = el.getAttribute('srcset').split(',');
      for (var j = 0; j < parts.length; j++) {
        var trimmed = parts[j].trim();
        if (trimmed.charAt(0) === '/' && trimmed.indexOf('://') === -1) {
          parts[j] = parts[j].replace(trimmed.split(' ')[0], origin + trimmed.split(' ')[0]);
        }
      }
      el.setAttribute('srcset', parts.join(','));
    }
    if (el.hasAttribute('poster') && el.getAttribute('poster').indexOf('://') === -1) {
      el.setAttribute('poster', origin + (el.getAttribute('poster').charAt(0) === '/' ? '' : '/') + el.getAttribute('poster'));
    }
  }

  // 1c. Remove canvas and video elements (they render blank in static capture)
  var blanks = target.querySelectorAll('canvas, video');
  for (var i = 0; i < blanks.length; i++) {
    blanks[i].parentNode.removeChild(blanks[i]);
  }

  // 2. Collect stylesheets
  var cssChunks = [];
  for (var i = 0; i < document.styleSheets.length; i++) {
    var sheet = document.styleSheets[i];
    try {
      var rules = sheet.cssRules || sheet.rules;
      var chunk = '';
      for (var j = 0; j < rules.length; j++) {
        chunk += rules[j].cssText + '\\n';
      }
      cssChunks.push(chunk);
    } catch (e) {
      // Cross-origin stylesheet — skip
    }
  }

  // 3. Build baseline computed styles for common tags
  var baselineCache = {};
  function getBaseline(tag) {
    if (baselineCache[tag]) return baselineCache[tag];
    var el = document.createElement(tag);
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
    var cs = window.getComputedStyle(el);
    var map = {};
    var props = [
      'display', 'position', 'width', 'height', 'min-width', 'min-height',
      'max-width', 'max-height', 'margin', 'padding', 'border',
      'background', 'background-color', 'background-image',
      'color', 'font-family', 'font-size', 'font-weight', 'line-height',
      'letter-spacing', 'text-align', 'text-decoration', 'text-transform',
      'flex-direction', 'justify-content', 'align-items', 'gap',
      'grid-template-columns', 'grid-template-rows',
      'border-radius', 'box-shadow', 'opacity', 'overflow',
      'transform', 'z-index', 'white-space'
    ];
    for (var i = 0; i < props.length; i++) {
      map[props[i]] = cs.getPropertyValue(props[i]);
    }
    document.body.removeChild(el);
    baselineCache[tag] = map;
    return map;
  }

  // 4. Walk DOM and capture computed styles
  var idCounter = 0;
  var computedRules = [];

  var props = [
    'display', 'position', 'width', 'height', 'min-width', 'min-height',
    'max-width', 'max-height', 'margin', 'padding', 'border',
    'background', 'background-color', 'background-image',
    'color', 'font-family', 'font-size', 'font-weight', 'line-height',
    'letter-spacing', 'text-align', 'text-decoration', 'text-transform',
    'flex-direction', 'justify-content', 'align-items', 'gap',
    'grid-template-columns', 'grid-template-rows',
    'border-radius', 'box-shadow', 'opacity', 'overflow',
    'transform', 'z-index', 'white-space'
  ];

  function walkAndCapture(el) {
    if (el.nodeType !== 1) return;
    var id = 'g' + (idCounter++);
    el.setAttribute('data-glue-id', id);

    var computed = window.getComputedStyle(el);
    var tag = el.tagName.toLowerCase();
    var defaults = getBaseline(tag);

    var diffs = [];
    for (var i = 0; i < props.length; i++) {
      var prop = props[i];
      var val = computed.getPropertyValue(prop);
      if (val && val !== defaults[prop]) {
        diffs.push(prop + ': ' + val);
      }
    }

    if (diffs.length > 0) {
      computedRules.push('[data-glue-id="' + id + '"] { ' + diffs.join('; ') + '; }');
    }

    for (var c = 0; c < el.children.length; c++) {
      walkAndCapture(el.children[c]);
    }
  }

  walkAndCapture(target);

  // Rewrite relative URLs in CSS (background-image, @font-face, etc.)
  var allCss = cssChunks.join('\\n');
  allCss = allCss.replace(/url\\(\\/([^)]+)\\)/g, 'url(' + origin + '/$1)');

  return {
    html: target.outerHTML,
    css: allCss,
    computedStyles: computedRules.join('\\n'),
    title: document.title,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    contentHeight: target.scrollHeight
  };
})()`;
}

export async function captureRenderedPage(opts: CaptureOptions): Promise<CaptureResult> {
  const win = new BrowserWindow({
    show: false,
    width: opts.viewportWidth ?? 1280,
    height: opts.viewportHeight ?? 800,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await win.loadURL(opts.url);

    // Wait for optional selector to appear (polling with timeout)
    if (opts.waitFor) {
      const waitForSelector = JSON.stringify(opts.waitFor);
      await win.webContents.executeJavaScript(`
        new Promise(function(resolve, reject) {
          var timeout = setTimeout(function() { reject(new Error('waitFor timeout: selector ' + ${waitForSelector} + ' not found within 10s')); }, 10000);
          function check() {
            if (document.querySelector(${waitForSelector})) {
              clearTimeout(timeout);
              resolve();
            } else {
              requestAnimationFrame(check);
            }
          }
          check();
        });
      `);
    }

    // Extra settle time for JS rendering
    await new Promise(r => setTimeout(r, opts.waitMs ?? 500));

    // Scroll through page to trigger IntersectionObserver-based lazy content
    // (useInView, scroll animations, lazy images) without resizing the window
    // (resizing would break vh-based layouts by inflating viewport height)
    await win.webContents.executeJavaScript(`
      new Promise(function(resolve) {
        var totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        var step = Math.max(window.innerHeight / 2, 200);
        var pos = 0;
        function scrollStep() {
          pos += step;
          window.scrollTo(0, pos);
          if (pos < totalHeight) {
            setTimeout(scrollStep, 60);
          } else {
            window.scrollTo(0, 0);
            setTimeout(resolve, 300);
          }
        }
        scrollStep();
      });
    `);

    // Inject capture script and extract DOM + styles
    const result = await win.webContents.executeJavaScript(buildCaptureScript(opts.selector));

    if (result.error) {
      throw new Error(result.error);
    }

    // Optional screenshot
    let screenshot: string | undefined;
    if (opts.includeScreenshot) {
      const image = await win.webContents.capturePage();
      screenshot = image.toPNG().toString('base64');
    }

    return {
      html: result.html,
      css: result.css,
      computedStyles: result.computedStyles,
      title: result.title,
      viewportWidth: result.viewportWidth,
      viewportHeight: result.viewportHeight,
      contentHeight: result.contentHeight,
      screenshot,
    };
  } finally {
    win.destroy();
  }
}
