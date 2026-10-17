import { isDarkTheme } from './common';

type Mermaid = typeof import('mermaid').default;

let mermaidPromise: Promise<Mermaid> | undefined;
let configuredDark: boolean | undefined;
let counter = 0;

/** Loads mermaid lazily (it is large) and keeps its theme in sync with VS Code. */
async function getMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidPromise;
  const dark = isDarkTheme();
  if (configuredDark !== dark) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
      // SVG text labels (instead of HTML) keep PNG export working and render the same everywhere.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      fontFamily: 'var(--vscode-font-family), sans-serif',
    });
    configuredDark = dark;
  }
  return mermaid;
}

/** Renders mermaid source to an SVG string; throws with mermaid's parse error message on invalid input. */
export async function renderMermaid(code: string): Promise<string> {
  const mermaid = await getMermaid();
  const id = `docdeck-mermaid-${++counter}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    // mermaid leaves a temporary element behind when rendering fails
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}
