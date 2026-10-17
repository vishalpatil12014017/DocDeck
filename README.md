# DocDeck – PDF, Excel, Word, Markdown & Mermaid Viewer

Open and edit common document formats directly inside **VS Code**, **Cursor** and **Antigravity**. Everything runs locally and works offline.

| File types | Editor | What you can do |
| --- | --- | --- |
| `.pdf` | PDF Viewer | Zoom (Ctrl/Cmd + wheel, `+`/`-`), fit page/width, rotate, page navigation, text selection, search (Ctrl/Cmd+F), password-protected files, auto-reload when the file changes |
| `.xlsx` `.xlsm` `.xls` `.ods` `.csv` `.tsv` | Spreadsheet Editor | Virtualized grid (100k+ rows), edit cells and formulas, formula bar, copy/paste with Excel/Sheets, insert/delete rows & columns, add/rename/delete sheets, resize columns, undo/redo, save/save-as |
| `.docx` | Word Document Editor | Paper-style rich text editor: headings, bold/italic/underline/strike, alignment, lists, quotes, links, images, tables. Saves back to `.docx` |
| `.md` `.markdown` | Markdown WYSIWYG Editor | Notion-style editing (slash menu, drag handles, tables, task lists, LaTeX math, code blocks with syntax highlighting). Mermaid code blocks render as diagrams. YAML front matter is preserved |
| `.mmd` `.mermaid` | Mermaid Diagram Viewer | Live rendering, pan & zoom, fit to window, export SVG/PNG, open source beside for editing |

## Usage

- PDF, spreadsheet, Word and Mermaid files open in the custom editor automatically.
- **Markdown** files still open as text by default, so coding workflows aren't disrupted. To use the WYSIWYG editor, click the preview icon in the editor title bar, right-click the file → **Open in WYSIWYG Editor**, or use **Open With… → Markdown WYSIWYG Editor**. To make it the default: *Open With… → Configure default editor for '*.md'*.
- From the Markdown or Mermaid editor, click the **Open Source Text** icon in the title bar to edit the raw text beside it. Both views stay in sync.
- To go back to the plain text editor for any type, use **Reopen Editor With… → Text Editor**.

## Known limitations

- **DOCX is "simple editing".** The file is converted to rich text when opened and rebuilt when saved. Text, headings, lists, tables, links, images and basic formatting survive. Headers/footers, comments, tracked changes, custom styles and exact page layout do not. You're asked before the original is overwritten the first time, and you can save a copy instead. Turn this prompt off with `docdeck.docx.confirmBeforeSave`.
- **Spreadsheet formulas are stored, not calculated.** Existing formula results are shown as saved in the file. New or edited formulas show their text until the file is opened in Excel/LibreOffice/Sheets, which compute them. Cell styling (colors, fonts) is not preserved when saving `.xlsx`.
- **CSV/TSV** values are kept exactly as typed (leading zeros, dates and long numbers aren't reformatted). Only the first sheet is used.
- **Markdown** is re-serialized by the editor after your first edit, so cosmetic syntax may be normalized (for example `*` bullets become `-`). Content is unchanged.

## Development

```bash
npm install
npm run build        # bundle extension + webviews into dist/
npm run watch        # rebuild on change
npm run typecheck    # type-check extension and webview code
```

Press **F5** in VS Code to launch an Extension Development Host with the extension loaded.

### Project layout

```
src/                     extension host (Node)
  extension.ts           activation, commands
  providers/             one custom editor provider per file type
webview/                 browser code for each editor UI (bundled by esbuild)
  pdf.ts  sheet.ts  docx.ts  markdown.ts  mermaid.ts
  mermaidRender.ts       shared Mermaid renderer (used by .mmd and Markdown)
esbuild.mjs              builds dist/extension.js and dist/webview/*
```

## Packaging & publishing

```bash
npm run package                         # -> docdeck-<version>.vsix
```

- **Install locally** in any of the three editors: Extensions view → `…` → *Install from VSIX…*, or `code --install-extension docdeck-0.1.0.vsix` (also `cursor --install-extension …`).
- **VS Code Marketplace:** `npx @vscode/vsce publish` (needs a publisher account and a personal access token).
- **Cursor and Antigravity** install extensions from **Open VSX**: `npx ovsx publish docdeck-0.1.0.vsix -p <token>`.

Before publishing, set `publisher` in `package.json` to your Marketplace/Open VSX publisher ID, and add a `repository`, an `icon` and a `LICENSE` file.

## Third-party libraries

[pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [SheetJS CE](https://sheetjs.com) (Apache-2.0), [mammoth](https://github.com/mwilliamson/mammoth.js) (BSD-2), [html-to-docx](https://github.com/TurboDocx/html-to-docx) (MIT), [Tiptap](https://tiptap.dev) (MIT), [Milkdown](https://milkdown.dev) (MIT), [Mermaid](https://mermaid.js.org) (MIT).
