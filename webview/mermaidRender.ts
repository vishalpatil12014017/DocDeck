type Mermaid = typeof import('mermaid').default;

let mermaidPromise: Promise<Mermaid> | undefined;
let initialized = false;
let counter = 0;

/** Loads mermaid lazily (it is large). Diagrams always use the light theme, like the rest of the preview. */
async function getMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidPromise;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      // SVG text labels (instead of HTML) keep PNG export working and render the same everywhere.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      fontFamily: 'var(--vscode-font-family), sans-serif',
    });
    initialized = true;
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
