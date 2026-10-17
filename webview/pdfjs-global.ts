// pdf_viewer.mjs reads the core library from globalThis.pdfjsLib, so it must be set before that module loads.
// The legacy build polyfills newer JS APIs (e.g. Uint8Array#toHex) that editors' bundled Chromium may lack.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

(globalThis as unknown as { pdfjsLib: typeof pdfjsLib }).pdfjsLib = pdfjsLib;

export { pdfjsLib };
