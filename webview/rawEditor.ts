import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState, Transaction } from '@codemirror/state';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { isDarkTheme, onThemeChange } from './common';
import type { RawContent } from './views';

export interface RawEditor {
  set(content: RawContent): void;
  focus(): void;
}

/** Matches the editor chrome to the active VS Code theme. */
const vscodeTheme = (dark: boolean) =>
  EditorView.theme(
    {
      '&': {
        height: '100%',
        color: 'var(--vscode-editor-foreground)',
        backgroundColor: 'var(--vscode-editor-background)',
        fontSize: 'var(--vscode-editor-font-size, 13px)',
      },
      '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family, monospace)', lineHeight: '1.5' },
      '.cm-content': { caretColor: 'var(--vscode-editorCursor-foreground)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--vscode-editorCursor-foreground)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--vscode-editor-selectionBackground) !important',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--vscode-editorGutter-background, var(--vscode-editor-background))',
        color: 'var(--vscode-editorLineNumber-foreground)',
        border: 'none',
      },
      '.cm-activeLine': { backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)' },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--vscode-editorLineNumber-activeForeground)',
      },
      '.cm-panels': {
        backgroundColor: 'var(--vscode-editorWidget-background)',
        color: 'var(--vscode-editorWidget-foreground, inherit)',
      },
      '.cm-searchMatch': { backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground)' },
      '.cm-searchMatch-selected': { backgroundColor: 'var(--vscode-editor-findMatchBackground)' },
      '.cm-textfield, .cm-button': {
        backgroundColor: 'var(--vscode-input-background)',
        color: 'var(--vscode-input-foreground)',
        border: '1px solid var(--vscode-input-border, transparent)',
        backgroundImage: 'none',
      },
    },
    { dark },
  );

const highlight = (dark: boolean) => syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle);

/** CodeMirror-based text view used by the Raw tab: editable for text formats, read-only for binary files. */
export function createRawEditor(parent: HTMLElement, onChange: (text: string) => void): RawEditor {
  const theme = new Compartment();
  const readOnly = new Compartment();
  const language = new Compartment();
  const wrapping = new Compartment();
  let applying = false;

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        theme.of([vscodeTheme(isDarkTheme()), highlight(isDarkTheme())]),
        readOnly.of(EditorState.readOnly.of(true)),
        language.of([]),
        wrapping.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applying) onChange(update.state.doc.toString());
        }),
      ],
    }),
  });

  onThemeChange(() => {
    view.dispatch({ effects: theme.reconfigure([vscodeTheme(isDarkTheme()), highlight(isDarkTheme())]) });
  });

  return {
    set({ text, readOnly: ro, language: lang }) {
      const effects = [
        // readOnly blocks edits but keeps the cursor, selection and search working.
        readOnly.reconfigure(EditorState.readOnly.of(ro)),
        language.reconfigure(lang === 'markdown' ? markdown() : []),
        // Binary files tend to have huge single lines; wrap them so they stay readable.
        wrapping.reconfigure(lang === 'plain' && ro ? EditorView.lineWrapping : []),
      ];
      const current = view.state.doc.toString();
      applying = true;
      view.dispatch({
        effects,
        ...(current !== text && {
          changes: { from: 0, to: current.length, insert: text },
          // Replacing the document from outside must not become an undo step.
          annotations: Transaction.addToHistory.of(false),
        }),
      });
      applying = false;
    },
    focus() {
      view.focus();
    },
  };
}
