interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

declare global {
  interface Window {
    __DOCDECK__: { assetBase: string; [key: string]: unknown };
  }
}

export const vscode = acquireVsCodeApi();
export const config = window.__DOCDECK__;

/** Merges into the webview's persisted state (setState alone would replace all of it). */
export function updateState(patch: Record<string, unknown>): void {
  vscode.setState({ ...(vscode.getState<Record<string, unknown>>() ?? {}), ...patch });
}

export function isDarkTheme(): boolean {
  const cls = document.body.classList;
  return cls.contains('vscode-dark') || cls.contains('vscode-high-contrast');
}

/** Fires when the user switches VS Code color theme (body class changes). */
export function onThemeChange(callback: () => void): void {
  new MutationObserver(callback).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

/**
 * Keeps Ctrl/Cmd+Z / Y inside editable areas of the webview. Without this the keystroke is also
 * forwarded to VS Code, which would run a second undo on the underlying document.
 */
export function keepUndoInsideEditable(): void {
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (!mod || (key !== 'z' && key !== 'y')) {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      e.stopPropagation();
    }
  });
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string; dataset?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(el, rest);
  if (dataset) {
    Object.assign(el.dataset, dataset);
  }
  el.append(...children);
  return el;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { flush(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;
  const debounced = (...args: A) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
  debounced.flush = () => {
    if (timer !== undefined && lastArgs) {
      clearTimeout(timer);
      timer = undefined;
      fn(...lastArgs);
    }
  };
  return debounced;
}
