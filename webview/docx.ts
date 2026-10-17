import './docx.css';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { debounce, h, keepUndoInsideEditable, vscode } from './common';
import { initViews } from './views';

keepUndoInsideEditable();
initViews();

const toolbar = h('div', { className: 'toolbar' });
const notice = h('div', { className: 'notice', hidden: true });
const page = h('div', { className: 'page' });
const scroller = h('div', { className: 'scroller' }, notice, page);
document.getElementById('app')!.append(toolbar, scroller);

let suppressChange = false;

const sendChange = debounce((html: string) => vscode.postMessage({ type: 'change', html }), 250);

const editor = new Editor({
  element: page,
  extensions: [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Image.configure({ allowBase64: true, inline: false }),
    TableKit.configure({ table: { resizable: true } }),
  ],
  content: '',
  onUpdate: ({ editor }) => {
    if (!suppressChange) sendChange(editor.getHTML());
  },
  onSelectionUpdate: () => refreshToolbar(),
  onTransaction: () => refreshToolbar(),
});

// Flush pending edits before VS Code saves (Ctrl/Cmd+S is forwarded to VS Code after this handler).
window.addEventListener(
  'keydown',
  (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') sendChange.flush();
  },
  true,
);

// ---------- Toolbar ----------
type Button = {
  label: string;
  title: string;
  run: () => void;
  active?: () => boolean;
  className?: string;
};

const chain = () => editor.chain().focus();

const blockSelect = h('select', { className: 'block-select', title: 'Text style' });
for (const [value, label] of [
  ['p', 'Normal text'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['h4', 'Heading 4'],
  ['pre', 'Code block'],
]) {
  blockSelect.append(h('option', { value, textContent: label }));
}
blockSelect.onchange = () => {
  const v = blockSelect.value;
  if (v === 'p') chain().setParagraph().run();
  else if (v === 'pre') chain().toggleCodeBlock().run();
  else chain().toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 | 4 }).run();
};

const groups: Button[][] = [
  [
    { label: '↶', title: 'Undo (Ctrl+Z)', run: () => chain().undo().run() },
    { label: '↷', title: 'Redo (Ctrl+Y)', run: () => chain().redo().run() },
  ],
  [
    { label: 'B', title: 'Bold (Ctrl+B)', run: () => chain().toggleBold().run(), active: () => editor.isActive('bold'), className: 'b' },
    { label: 'I', title: 'Italic (Ctrl+I)', run: () => chain().toggleItalic().run(), active: () => editor.isActive('italic'), className: 'i' },
    { label: 'U', title: 'Underline (Ctrl+U)', run: () => chain().toggleUnderline().run(), active: () => editor.isActive('underline'), className: 'u' },
    { label: 'S', title: 'Strikethrough', run: () => chain().toggleStrike().run(), active: () => editor.isActive('strike'), className: 's' },
    { label: '</>', title: 'Inline code', run: () => chain().toggleCode().run(), active: () => editor.isActive('code') },
  ],
  [
    { label: '⇤', title: 'Align left', run: () => chain().setTextAlign('left').run(), active: () => editor.isActive({ textAlign: 'left' }) },
    { label: '⇔', title: 'Align center', run: () => chain().setTextAlign('center').run(), active: () => editor.isActive({ textAlign: 'center' }) },
    { label: '⇥', title: 'Align right', run: () => chain().setTextAlign('right').run(), active: () => editor.isActive({ textAlign: 'right' }) },
    { label: '☰', title: 'Justify', run: () => chain().setTextAlign('justify').run(), active: () => editor.isActive({ textAlign: 'justify' }) },
  ],
  [
    { label: '•', title: 'Bulleted list', run: () => chain().toggleBulletList().run(), active: () => editor.isActive('bulletList') },
    { label: '1.', title: 'Numbered list', run: () => chain().toggleOrderedList().run(), active: () => editor.isActive('orderedList') },
    { label: '❝', title: 'Quote', run: () => chain().toggleBlockquote().run(), active: () => editor.isActive('blockquote') },
    { label: '―', title: 'Horizontal line', run: () => chain().setHorizontalRule().run() },
  ],
  [
    { label: '🔗', title: 'Link', run: () => editLink(), active: () => editor.isActive('link') },
    { label: '🖼', title: 'Insert image', run: () => pickImage() },
    { label: '▦', title: 'Insert table', run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: '⌫', title: 'Clear formatting', run: () => chain().unsetAllMarks().clearNodes().run() },
  ],
];

const tableGroup: Button[] = [
  { label: '+R', title: 'Add row below', run: () => chain().addRowAfter().run() },
  { label: '+C', title: 'Add column right', run: () => chain().addColumnAfter().run() },
  { label: '−R', title: 'Delete row', run: () => chain().deleteRow().run() },
  { label: '−C', title: 'Delete column', run: () => chain().deleteColumn().run() },
  { label: '✕▦', title: 'Delete table', run: () => chain().deleteTable().run() },
];

const buttonEls: { el: HTMLButtonElement; def: Button }[] = [];
const makeButton = (def: Button) => {
  const el = h('button', { textContent: def.label, title: def.title, className: `tb-btn ${def.className ?? ''}` });
  el.onmousedown = (e) => e.preventDefault(); // keep editor selection
  el.onclick = def.run;
  buttonEls.push({ el, def });
  return el;
};

toolbar.append(h('div', { className: 'group' }, blockSelect));
for (const group of groups) toolbar.append(h('div', { className: 'group' }, ...group.map(makeButton)));
const tableTools = h('div', { className: 'group table-tools' }, ...tableGroup.map(makeButton));
toolbar.append(tableTools);

function refreshToolbar() {
  for (const { el, def } of buttonEls) el.classList.toggle('on', def.active?.() ?? false);
  tableTools.hidden = !editor.isActive('table');
  const level = [1, 2, 3, 4].find((l) => editor.isActive('heading', { level: l }));
  blockSelect.value = level ? `h${level}` : editor.isActive('codeBlock') ? 'pre' : 'p';
}

function editLink() {
  const current = editor.getAttributes('link').href ?? '';
  const bar = h('div', { className: 'inline-prompt' });
  const input = h('input', { value: current, placeholder: 'https://example.com' });
  const close = () => bar.remove();
  const apply = () => {
    const url = input.value.trim();
    if (url) chain().extendMarkRange('link').setLink({ href: url }).run();
    else chain().extendMarkRange('link').unsetLink().run();
    close();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') apply();
    if (e.key === 'Escape') close();
  };
  bar.append(
    h('span', { textContent: 'Link URL:' }),
    input,
    h('button', { textContent: 'Apply', className: 'primary', onclick: apply }),
    h('button', { textContent: 'Remove', onclick: () => ((input.value = ''), apply()) }),
    h('button', { textContent: 'Cancel', onclick: close }),
  );
  toolbar.after(bar);
  input.focus();
  input.select();
}

function pickImage() {
  const input = h('input', { type: 'file', accept: 'image/*' });
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => chain().setImage({ src: String(reader.result), alt: file.name }).run();
    reader.readAsDataURL(file);
  };
  input.click();
}

// ---------- Messages ----------
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'load') {
    suppressChange = true;
    editor.commands.setContent(msg.html, { emitUpdate: false });
    suppressChange = false;
    if (msg.warnings?.length) {
      notice.hidden = false;
      notice.replaceChildren(
        h('span', { textContent: `Some formatting in this document isn't supported by the editor (${msg.warnings.length} item${msg.warnings.length > 1 ? 's' : ''}). ` }),
        h('button', { textContent: 'Dismiss', onclick: () => (notice.hidden = true) }),
      );
      notice.title = msg.warnings.slice(0, 20).join('\n');
    }
    refreshToolbar();
  }
});

vscode.postMessage({ type: 'ready' });
