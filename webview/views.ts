import './views.css';
import { config, debounce, h, updateState, vscode } from './common';
import type { RawEditor } from './rawEditor';

export interface RawContent {
  text: string;
  readOnly: boolean;
  language?: 'markdown' | 'csv' | 'plain';
  notice?: string;
}

type Mode = 'preview' | 'raw' | 'split';
const MODES: Mode[] = ['preview', 'raw', 'split'];

interface ViewsOptions {
  /** Supplies the Raw pane's content when it opens. By default the extension is asked ('getRaw' -> 'raw'). */
  loadRaw?: () => void;
  /** Receives edits made in the Raw pane (debounced). Only called for editable content. */
  onRawEdit?: (text: string) => void;
  /** Called when the preview becomes visible again after being hidden by the Raw tab. */
  onShowPreview?: () => void;
}

export interface Views {
  setRaw(content: RawContent): Promise<void>;
  /** True when the Raw pane is on screen (Raw tab or Split). */
  rawVisible(): boolean;
  /** True when the preview is on screen (Preview tab or Split). */
  previewVisible(): boolean;
  /** Reloads the Raw pane if it is showing (e.g. after the file or the preview changed). */
  refreshRaw(): void;
}

/**
 * Adds the "Preview | Raw | Split" tab bar above an editor. The preview lives in #app, the raw text
 * in #raw; Split shows both side by side with a draggable divider.
 */
export function initViews(options: ViewsOptions = {}): Views {
  const app = document.getElementById('app')!;
  // The page shell normally provides these; create them if it doesn't (e.g. a webview built by an
  // older extension version that is still running right after an in-place reinstall).
  const viewbar = document.getElementById('viewbar') ?? h('div', { id: 'viewbar' });
  const rawEl = document.getElementById('raw') ?? h('div', { id: 'raw', hidden: true });
  viewbar.setAttribute('role', 'tablist');
  if (!viewbar.isConnected) app.before(viewbar);
  if (!rawEl.isConnected) app.after(rawEl);

  const labels: Record<Mode, [string, string]> = {
    preview: ['Preview', 'Rendered view'],
    raw: ['Raw', 'The file as plain text (Ctrl/Cmd+Alt+R toggles Preview/Raw)'],
    split: ['Split', 'Preview and raw text side by side'],
  };
  const tabs = Object.fromEntries(
    MODES.map((m) => [m, h('button', { className: 'vb-tab', textContent: labels[m][0], title: labels[m][1], role: 'tab', onclick: () => show(m) })]),
  ) as Record<Mode, HTMLButtonElement>;
  viewbar.append(...MODES.map((m) => tabs[m]));

  const notice = h('div', { className: 'raw-notice', hidden: true });
  const host = h('div', { className: 'raw-host' });
  rawEl.append(notice, host);
  const divider = h('div', { id: 'split-divider', hidden: true, title: 'Drag to resize' });
  rawEl.before(divider);

  let mode: Mode = 'preview';
  let editorLoading: Promise<RawEditor> | undefined;

  const emitEdit = debounce((text: string) => options.onRawEdit?.(text), 300);
  const loadRaw = options.loadRaw ?? (() => vscode.postMessage({ type: 'getRaw' }));
  const rawVisible = () => mode !== 'preview';
  const previewVisible = () => mode !== 'raw';

  function getEditor(): Promise<RawEditor> {
    editorLoading ??= import('./rawEditor').then((m) => m.createRawEditor(host, emitEdit));
    return editorLoading;
  }

  async function setRaw(content: RawContent) {
    notice.hidden = !content.notice;
    notice.textContent = content.notice ?? '';
    (await getEditor()).set(content);
  }

  function show(next: Mode) {
    if (next === mode) return;
    emitEdit.flush();
    const wasRaw = rawVisible();
    const wasPreview = previewVisible();
    mode = next;
    for (const m of MODES) {
      tabs[m].classList.toggle('on', m === mode);
      tabs[m].setAttribute('aria-selected', String(m === mode));
    }
    rawEl.hidden = !rawVisible();
    divider.hidden = mode !== 'split';
    app.inert = !previewVisible();
    document.body.classList.toggle('raw-mode', mode === 'raw');
    document.body.classList.toggle('split-mode', mode === 'split');
    if (rawVisible() && !wasRaw) loadRaw();
    if (previewVisible() && !wasPreview) options.onShowPreview?.();
    if (mode === 'raw') getEditor().then((e) => e.focus());
    // Let size-dependent previews (PDF zoom, diagram fit, grid) re-layout for the new width.
    window.dispatchEvent(new Event('resize'));
  }
  tabs.preview.classList.add('on');
  tabs.preview.setAttribute('aria-selected', 'true');

  // Divider drag: the raw pane width is a percentage of the window, kept between 20% and 80%.
  const setRawWidth = (percent: number) => document.documentElement.style.setProperty('--raw-w', `${percent}%`);
  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('resizing');
    const move = (ev: MouseEvent) => {
      const percent = Math.min(80, Math.max(20, ((window.innerWidth - ev.clientX) / window.innerWidth) * 100));
      setRawWidth(Math.round(percent * 10) / 10);
    };
    const up = () => {
      document.body.classList.remove('resizing');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      updateState({ rawWidth: document.documentElement.style.getPropertyValue('--raw-w') });
      window.dispatchEvent(new Event('resize'));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'raw') setRaw(e.data);
  });
  window.addEventListener(
    'keydown',
    (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') emitEdit.flush(); // push raw edits before VS Code saves
      if (mod && e.altKey && e.code === 'KeyR') {
        e.preventDefault();
        show(mode === 'preview' ? 'raw' : 'preview');
      }
    },
    true,
  );

  // Files always open in the configured view (Preview unless docdeck.defaultView says otherwise).
  const saved = vscode.getState<{ rawWidth?: string }>();
  if (saved?.rawWidth) document.documentElement.style.setProperty('--raw-w', saved.rawWidth);
  const initial = config.defaultView as Mode | undefined;
  if (initial && initial !== 'preview' && MODES.includes(initial)) queueMicrotask(() => show(initial));

  return {
    setRaw,
    rawVisible,
    previewVisible,
    refreshRaw: () => {
      if (rawVisible()) loadRaw();
    },
  };
}
