import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import './pdf.css';
import { pdfjsLib } from './pdfjs-global';
import { config, h, updateState, vscode } from './common';
import { initViews } from './views';

const views = initViews();

type ViewerModule = typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs');
const viewerLib: ViewerModule = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs');

const pdfjsBase = `${config.assetBase}pdfjs/`;

// Webview resources live on a different origin than the page, so the worker is loaded through a blob URL.
async function createWorker(): Promise<Worker> {
  const source = await (await fetch(`${pdfjsBase}pdf.worker.min.mjs`)).text();
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  return new Worker(url, { type: 'module' });
}
pdfjsLib.GlobalWorkerOptions.workerPort = await createWorker();

// ---------- UI ----------
const btn = (title: string, label: string, onClick: () => void) =>
  h('button', { title, textContent: label, onclick: onClick, className: 'tb-btn' });

const pageInput = h('input', { type: 'number', min: '1', value: '1', className: 'page-input', title: 'Page' });
const pageCount = h('span', { className: 'page-count', textContent: '/ 0' });
const zoomSelect = h('select', { className: 'zoom-select', title: 'Zoom' });
for (const [value, label] of [
  ['auto', 'Automatic'],
  ['page-fit', 'Fit Page'],
  ['page-width', 'Fit Width'],
  ['0.5', '50%'],
  ['0.75', '75%'],
  ['1', '100%'],
  ['1.25', '125%'],
  ['1.5', '150%'],
  ['2', '200%'],
  ['3', '300%'],
  ['4', '400%'],
]) {
  zoomSelect.append(h('option', { value, textContent: label }));
}
const customZoom = h('option', { value: 'custom', hidden: true });
zoomSelect.append(customZoom);

const findInput = h('input', { type: 'search', placeholder: 'Find in document', className: 'find-input' });
const findCount = h('span', { className: 'find-count' });

const toolbar = h(
  'div',
  { className: 'toolbar' },
  h(
    'div',
    { className: 'group' },
    btn('Previous page', '‹', () => viewer.previousPage()),
    pageInput,
    pageCount,
    btn('Next page', '›', () => viewer.nextPage()),
  ),
  h(
    'div',
    { className: 'group' },
    btn('Zoom out', '−', () => viewer.decreaseScale()),
    zoomSelect,
    btn('Zoom in', '+', () => viewer.increaseScale()),
    btn('Rotate', '⟳', () => (viewer.pagesRotation = (viewer.pagesRotation + 90) % 360)),
  ),
  h(
    'div',
    { className: 'group' },
    findInput,
    findCount,
    btn('Previous match', '↑', () => find('again', true)),
    btn('Next match', '↓', () => find('again', false)),
  ),
);

const viewerEl = h('div', { className: 'pdfViewer' });
const container = h('div', { id: 'viewerContainer' }, viewerEl);
const message = h('div', { className: 'message' });
document.getElementById('app')!.append(toolbar, container, message);

// ---------- Viewer ----------
const eventBus = new viewerLib.EventBus();
const linkService = new viewerLib.PDFLinkService({ eventBus });
const findController = new viewerLib.PDFFindController({ eventBus, linkService });
const viewer = new viewerLib.PDFViewer({
  container,
  viewer: viewerEl,
  eventBus,
  linkService,
  findController,
  textLayerMode: 1,
});
linkService.setViewer(viewer);

eventBus.on('pagesinit', () => {
  const saved = vscode.getState<{ scale?: string; page?: number }>();
  viewer.currentScaleValue = saved?.scale ?? 'auto';
  if (saved?.page) {
    viewer.currentPageNumber = Math.min(saved.page, viewer.pagesCount);
  }
});
eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
  pageInput.value = String(pageNumber);
  saveState();
});
eventBus.on('scalechanging', ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
  if (presetValue && [...zoomSelect.options].some((o) => o.value === presetValue)) {
    zoomSelect.value = presetValue;
  } else {
    const match = [...zoomSelect.options].find((o) => Number(o.value) === scale);
    if (match) {
      zoomSelect.value = match.value;
    } else {
      customZoom.textContent = `${Math.round(scale * 100)}%`;
      zoomSelect.value = 'custom';
    }
  }
  saveState();
});
eventBus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
  findCount.textContent = matchesCount.total ? `${matchesCount.current} of ${matchesCount.total}` : '';
});
eventBus.on('updatefindcontrolstate', ({ state, matchesCount }: { state: number; matchesCount: { current: number; total: number } }) => {
  if (state === viewerLib.FindState.NOT_FOUND) {
    findCount.textContent = 'No results';
  } else if (matchesCount?.total) {
    findCount.textContent = `${matchesCount.current} of ${matchesCount.total}`;
  }
});

function saveState() {
  updateState({ scale: viewer.currentScaleValue, page: viewer.currentPageNumber });
}

function find(type: '' | 'again', findPrevious = false) {
  eventBus.dispatch('find', {
    source: null,
    type,
    query: findInput.value,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious,
    matchDiacritics: false,
  });
}

new ResizeObserver(() => {
  const preset = viewer.currentScaleValue;
  if (viewer.pagesCount && ['auto', 'page-width', 'page-fit'].includes(preset)) viewer.currentScaleValue = preset;
}).observe(container);

pageInput.addEventListener('change', () => {
  const n = Number(pageInput.value);
  if (n >= 1 && n <= viewer.pagesCount) {
    viewer.currentPageNumber = n;
  } else {
    pageInput.value = String(viewer.currentPageNumber);
  }
});
zoomSelect.addEventListener('change', () => {
  if (zoomSelect.value !== 'custom') {
    viewer.currentScaleValue = zoomSelect.value;
  }
});
findInput.addEventListener('input', () => find(''));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    find('again', e.shiftKey);
  }
});

window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    findInput.focus();
    findInput.select();
  } else if (mod && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    viewer.increaseScale();
  } else if (mod && e.key === '-') {
    e.preventDefault();
    viewer.decreaseScale();
  } else if (mod && e.key === '0') {
    e.preventDefault();
    viewer.currentScaleValue = 'auto';
  }
});
// Ctrl/Cmd + mouse wheel zoom
container.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        viewer.increaseScale();
      } else {
        viewer.decreaseScale();
      }
    }
  },
  { passive: false },
);

// ---------- Loading ----------
// Browser dialogs (prompt) are blocked in webviews, so ask for passwords with an inline form.
function askPassword(retry: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'password', placeholder: 'Password', className: 'find-input' });
    const done = (value: string | null) => {
      form.remove();
      resolve(value);
    };
    const form = h(
      'form',
      { className: 'password-form' },
      h('div', { textContent: retry ? 'Incorrect password. Try again:' : 'This PDF is password protected.' }),
      input,
      h('button', { type: 'submit', textContent: 'Open', className: 'tb-btn' }),
      h('button', { type: 'button', textContent: 'Cancel', className: 'tb-btn', onclick: () => done(null) }),
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      done(input.value);
    };
    document.getElementById('app')!.append(form);
    input.focus();
  });
}

let currentTask: { destroy(): Promise<void> } | undefined;

async function load(data: Uint8Array) {
  message.textContent = '';
  try {
    const task = pdfjsLib.getDocument({
      data,
      cMapUrl: `${pdfjsBase}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${pdfjsBase}standard_fonts/`,
      wasmUrl: `${pdfjsBase}wasm/`,
      iccUrl: `${pdfjsBase}iccs/`,
      useWorkerFetch: false,
    });
    task.onPassword = (updatePassword: (pw: string) => void, reason: number) => {
      askPassword(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD).then((pw) => {
        if (pw === null) message.textContent = 'Password required to open this PDF.';
        else updatePassword(pw);
      });
    };
    const pdf = await task.promise;
    const previous = currentTask;
    currentTask = task;
    viewer.setDocument(pdf);
    linkService.setDocument(pdf, null);
    pageCount.textContent = `/ ${pdf.numPages}`;
    pageInput.max = String(pdf.numPages);
    await previous?.destroy();
  } catch (err) {
    message.textContent = `Could not open PDF: ${(err as Error).message ?? err}`;
  }
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    // Accept a serialized Node Buffer ({type:'Buffer', data:[...]}) as well as raw bytes.
    load(msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data?.data ?? msg.data));
    views.refreshRaw();
  } else if (msg.type === 'error') {
    message.textContent = msg.message;
  }
});

vscode.postMessage({ type: 'ready' });
