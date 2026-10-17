// pdf_viewer.mjs reads the core library from globalThis.pdfjsLib, so it must be set before that module loads.
import * as pdfjsLib from 'pdfjs-dist';

(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib;

export { pdfjsLib };
