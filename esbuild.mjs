import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });

/** Extension host bundle (Node, CommonJS). */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode', 'sharp'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** Webview bundles (browser, ES modules with shared chunks so mermaid is only shipped once). */
const webviewConfig = {
  entryPoints: {
    pdf: 'webview/pdf.ts',
    sheet: 'webview/sheet.ts',
    docx: 'webview/docx.ts',
    markdown: 'webview/markdown.ts',
    mermaid: 'webview/mermaid.ts',
  },
  bundle: true,
  outdir: 'dist/webview',
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  splitting: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome114',
  sourcemap: !production,
  minify: production,
  loader: {
    '.svg': 'dataurl',
    '.png': 'dataurl',
    '.gif': 'dataurl',
    '.woff': 'file',
    '.woff2': 'file',
    '.ttf': 'file',
  },
  logLevel: 'info',
};

function copyPdfjsAssets() {
  mkdirSync('dist/webview/pdfjs', { recursive: true });
  cpSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'dist/webview/pdfjs/pdf.worker.min.mjs');
  for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    cpSync(`node_modules/pdfjs-dist/${dir}`, `dist/webview/pdfjs/${dir}`, { recursive: true });
  }
}

copyPdfjsAssets();

if (watch) {
  const contexts = await Promise.all([esbuild.context(extensionConfig), esbuild.context(webviewConfig)]);
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
}
