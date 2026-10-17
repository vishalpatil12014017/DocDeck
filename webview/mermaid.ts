import './mermaid.css';
import { debounce, h, vscode } from './common';
import { renderMermaid } from './mermaidRender';
import { initViews } from './views';

const zoomLabel = h('span', { className: 'zoom-label', textContent: '100%' });
const btn = (label: string, title: string, onclick: () => void) => h('button', { className: 'tb-btn', textContent: label, title, onclick });

const toolbar = h(
  'div',
  { className: 'toolbar' },
  h('div', { className: 'group' }, btn('−', 'Zoom out', () => zoomBy(1 / 1.2)), zoomLabel, btn('+', 'Zoom in', () => zoomBy(1.2)), btn('Fit', 'Fit to window', fit), btn('1:1', 'Actual size', () => ((userZoomed = true), setZoom(1, true)))),
  h(
    'div',
    { className: 'group' },
    btn('Export SVG', 'Save diagram as SVG', () => exportAs('svg')),
    btn('Export PNG', 'Save diagram as PNG', () => exportAs('png')),
  ),
);
const canvas = h('div', { className: 'canvas' });
const stage = h('div', { className: 'stage' }, canvas);
const errorBox = h('pre', { className: 'error', hidden: true });
document.getElementById('app')!.append(toolbar, stage, errorBox);

let source = '';

const views = initViews({
  loadRaw: () => views.setRaw({ text: source, readOnly: false, language: 'plain' }),
  onRawEdit: (text) => {
    source = text;
    render();
    vscode.postMessage({ type: 'edit', text });
  },
});
let svgText = '';
let zoom = 1;
let pan = { x: 0, y: 0 };
let fitted = false;
/** Once the user pans or zooms, stop auto-fitting on resize. */
let userZoomed = false;

function applyTransform() {
  canvas.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function svgSize(): { w: number; h: number } {
  const svg = canvas.querySelector('svg');
  if (!svg) return { w: 0, h: 0 };
  const vb = svg.viewBox.baseVal;
  return vb && vb.width ? { w: vb.width, h: vb.height } : { w: svg.clientWidth, h: svg.clientHeight };
}

function setZoom(z: number, center = false) {
  zoom = Math.min(10, Math.max(0.05, z));
  if (center) {
    const { w, h } = svgSize();
    pan = { x: (stage.clientWidth - w * zoom) / 2, y: Math.max(16, (stage.clientHeight - h * zoom) / 2) };
  }
  applyTransform();
}

function zoomBy(factor: number, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) {
  userZoomed = true;
  const next = Math.min(10, Math.max(0.05, zoom * factor));
  pan = { x: cx - ((cx - pan.x) * next) / zoom, y: cy - ((cy - pan.y) * next) / zoom };
  zoom = next;
  applyTransform();
}

function fit() {
  const { w, h } = svgSize();
  if (!w || !h) return;
  userZoomed = false;
  const pad = 32;
  setZoom(Math.min((stage.clientWidth - pad) / w, (stage.clientHeight - pad) / h, 2), true);
}

const render = debounce(async () => {
  if (!source.trim()) {
    canvas.innerHTML = '';
    errorBox.hidden = false;
    errorBox.textContent = 'This file is empty. Switch to the Raw tab to write a Mermaid diagram.';
    return;
  }
  try {
    svgText = await renderMermaid(source);
    canvas.innerHTML = svgText;
    const svg = canvas.querySelector('svg');
    if (svg) {
      const { w, h } = svgSize();
      svg.style.maxWidth = 'none';
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
    }
    canvas.classList.remove('stale');
    errorBox.hidden = true;
    if (!fitted) {
      fitted = true;
      fit();
    }
  } catch (err) {
    // Keep the last good diagram visible (dimmed) while the source is being edited.
    canvas.classList.add('stale');
    errorBox.hidden = false;
    errorBox.textContent = String((err as Error)?.message ?? err);
  }
}, 150);

// ---------- Pan & zoom ----------
let drag: { x: number; y: number; px: number; py: number } | null = null;
stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  userZoomed = true;
  stage.classList.add('dragging');
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  pan = { x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y };
  applyTransform();
});
window.addEventListener('mouseup', () => {
  drag = null;
  stage.classList.remove('dragging');
});
stage.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
    } else {
      userZoomed = true;
      pan = { x: pan.x - e.deltaX, y: pan.y - e.deltaY };
      applyTransform();
    }
  },
  { passive: false },
);
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === '=' || e.key === '+')) zoomBy(1.2);
  else if (mod && e.key === '-') zoomBy(1 / 1.2);
  else if (mod && e.key === '0') fit();
  else return;
  e.preventDefault();
});

// ---------- Export ----------
async function exportAs(format: 'svg' | 'png') {
  const svg = canvas.querySelector('svg');
  if (!svg) return;
  const markup = new XMLSerializer().serializeToString(svg);
  if (format === 'svg') {
    vscode.postMessage({ type: 'export', format, data: `<?xml version="1.0" encoding="UTF-8"?>\n${markup}` });
    return;
  }
  const { w, h } = svgSize();
  const scale = 2;
  const img = new Image();
  img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  try {
    vscode.postMessage({ type: 'export', format, data: c.toDataURL('image/png') });
  } catch (err) {
    errorBox.hidden = false;
    errorBox.textContent = `PNG export failed: ${(err as Error).message}. Try Export SVG instead.`;
  }
}

new ResizeObserver(() => {
  if (fitted && !userZoomed) fit();
}).observe(stage);

window.addEventListener('message', (e) => {
  if (e.data.type === 'update' && e.data.text !== source) {
    source = e.data.text;
    render();
    if (views.rawVisible()) views.setRaw({ text: source, readOnly: false, language: 'plain' });
  }
});

vscode.postMessage({ type: 'ready' });
