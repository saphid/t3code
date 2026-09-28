import { isAbsolutePath } from "~/terminal-links";

/** Rendered (true) or source (false) for HTML files; shared with extension packs. */
export const RENDER_BROWSER_FILE_STORAGE_KEY = "t3code.renderBrowserFile";
/** Whether the file explorer shows beside an open file; shared with extension packs. */
export const FILE_EXPLORER_STORAGE_KEY = "t3code.fileExplorerOpen";

export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

export function shouldShowFileExplorer(input: {
  readonly relativePath: string | null;
  readonly explorerOpen: boolean;
  readonly attachmentOpen: boolean;
}): boolean {
  if (input.attachmentOpen || (input.relativePath && isAbsolutePath(input.relativePath))) {
    return false;
  }
  return input.explorerOpen || input.relativePath === null;
}

export function setMarkdownTaskChecked(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string {
  if (
    markerOffset < 0 ||
    markdown[markerOffset] !== "[" ||
    !/[ xX]/.test(markdown[markerOffset + 1] ?? "") ||
    markdown[markerOffset + 2] !== "]"
  ) {
    return markdown;
  }

  return `${markdown.slice(0, markerOffset + 1)}${checked ? "x" : " "}${markdown.slice(markerOffset + 2)}`;
}
