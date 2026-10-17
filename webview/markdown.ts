import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import './markdown.css';
import { Crepe } from '@milkdown/crepe';
import { EditorView } from '@codemirror/view';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { replaceAll } from '@milkdown/kit/utils';
import { config, debounce, h, keepUndoInsideEditable, vscode } from './common';
import { renderMermaid } from './mermaidRender';
import { initViews } from './views';

keepUndoInsideEditable();

const baseUri = String(config.baseUri ?? '');
const root = h('div', { className: 'editor-root' });
document.getElementById('app')!.append(root);

/** YAML front matter is kept out of the editor (it would be mangled) and re-attached on save. */
const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/;
let frontMatter = '';
/** Markdown as last serialized by the editor; changes are only sent when this differs. */
let lastMarkdown = '';
/** Full document text last sent to or received from VS Code. */
let lastText = '';
let crepe: Crepe | undefined;
/** Set when the Raw pane changed the text while the WYSIWYG view was hidden; it reloads when shown. */
let previewStale = false;

const views = initViews({
  loadRaw: () => {
    sendEdit.flush();
    views.setRaw({ text: lastText, readOnly: false, language: 'markdown' });
  },
  onRawEdit: (text) => {
    lastText = text;
    vscode.postMessage({ type: 'edit', text });
    // In Split view the preview updates as you type; otherwise it catches up when shown.
    if (views.previewVisible()) syncPreview(text);
    else previewStale = true;
  },
  onShowPreview: () => {
    if (previewStale) syncPreview(lastText);
  },
});

function splitFrontMatter(text: string): string {
  const match = text.match(FRONT_MATTER);
  frontMatter = match ? match[0] : '';
  return match ? text.slice(match[0].length) : text;
}

const sendEdit = debounce((markdown: string) => {
  lastText = frontMatter + markdown;
  vscode.postMessage({ type: 'edit', text: lastText });
  if (views.rawVisible()) views.setRaw({ text: lastText, readOnly: false, language: 'markdown' });
}, 200);

function resolveUrl(url: string): string {
  if (!url || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return url;
  try {
    return new URL(url, baseUri).toString();
  } catch {
    return url;
  }
}

function renderPreview(language: string, content: string, applyPreview: (value: null | string | HTMLElement) => void) {
  if (language.toLowerCase() !== 'mermaid' || !content.trim()) return null;
  renderMermaid(content)
    .then((svg) => {
      const el = h('div', { className: 'mermaid-preview' });
      el.innerHTML = svg;
      applyPreview(el);
    })
    .catch((err) => applyPreview(h('pre', { className: 'mermaid-error', textContent: String(err?.message ?? err) })));
  return undefined;
}

async function init(text: string) {
  lastText = text;
  const body = splitFrontMatter(text);
  crepe = new Crepe({
    root,
    defaultValue: body,
    features: { [Crepe.Feature.AI]: false, [Crepe.Feature.TopBar]: false },
    featureConfigs: {
      // Crepe defaults code blocks to the One Dark theme; the preview is light, so use light colors.
      [Crepe.Feature.CodeMirror]: {
        renderPreview,
        previewOnlyByDefault: true,
        theme: [EditorView.theme({ '&': { color: '#1f2328' } }, { dark: false }), syntaxHighlighting(defaultHighlightStyle)],
      },
      [Crepe.Feature.ImageBlock]: { proxyDomURL: resolveUrl },
      [Crepe.Feature.Placeholder]: { text: 'Start writing… (type / for commands)' },
    },
  });
  await crepe.create();
  // Baseline is the editor's own serialization, so merely opening a file never marks it dirty.
  lastMarkdown = crepe.getMarkdown();
  if (views.rawVisible()) views.setRaw({ text, readOnly: false, language: 'markdown' });
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      if (markdown === lastMarkdown) return;
      lastMarkdown = markdown;
      sendEdit(markdown);
    });
  });
}

/** Loads text into the WYSIWYG editor without echoing it back as an edit. */
function syncPreview(text: string) {
  if (!crepe) return;
  previewStale = false;
  crepe.editor.action(replaceAll(splitFrontMatter(text)));
  lastMarkdown = crepe.getMarkdown();
}

/** The document changed outside this webview (text editor, git, another tool). */
function applyExternal(text: string) {
  if (!crepe || text === lastText) return;
  sendEdit.flush();
  lastText = text;
  if (views.rawVisible()) views.setRaw({ text, readOnly: false, language: 'markdown' });
  if (views.previewVisible()) syncPreview(text);
  else previewStale = true;
}

// Ctrl/Cmd+S: push pending edits before VS Code saves.
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') sendEdit.flush();
}, true);

// Ctrl/Cmd+click opens links (relative .md links open in VS Code).
root.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  if (!a || !(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  vscode.postMessage({ type: 'openLink', href: a.getAttribute('href') ?? '' });
});

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    init(msg.text).catch((err) => {
      root.textContent = `Could not open this file in the WYSIWYG editor: ${err?.message ?? err}`;
    });
  } else if (msg.type === 'update') {
    applyExternal(msg.text);
  }
});

vscode.postMessage({ type: 'ready' });
