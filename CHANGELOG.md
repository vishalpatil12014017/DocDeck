# Changelog

## 0.1.0

First release.

- **PDF viewer:** zoom, fit page/width, rotate, page navigation, text selection, search, password-protected files, auto-reload on change.
- **Spreadsheet editor** (`.xlsx`, `.xlsm`, `.xls`, `.ods`, `.csv`, `.tsv`): virtualized grid, cell and formula editing, formula bar, copy/paste, insert/delete rows and columns, sheet tabs, column resizing, undo/redo.
- **Word editor** (`.docx`): rich text with headings, lists, tables, links, images and alignment; saves back to `.docx`.
- **Markdown WYSIWYG editor:** slash commands, tables, math, code highlighting, Mermaid diagrams in code blocks, front matter preserved.
- **Mermaid viewer** (`.mmd`, `.mermaid`): live preview, pan and zoom, SVG/PNG export.
- Previews always use a light theme, regardless of the VS Code theme.
- **Preview / Raw / Split tabs** in every editor (Ctrl/Cmd+Alt+R toggles Preview/Raw; `docdeck.defaultView` picks the starting view). Split shows both side by side with a resizable divider and live sync.
- Markdown files open in DocDeck by default. Raw is editable for Markdown, Mermaid, CSV and TSV, and shows the bytes as text for PDF, Excel and Word.
