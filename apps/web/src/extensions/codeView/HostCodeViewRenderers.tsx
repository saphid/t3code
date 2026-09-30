import type { CodeViewItem, FileDiffContentsLoader } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { CodeViewDiffProps, CodeViewFileProps } from "@t3tools/extension-sdk/environment";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StyledDiffCodeView } from "~/components/diffs/StyledDiffCodeView";
import { useCodeViewFileReveal } from "~/components/diffs/useCodeViewFileReveal";
import ReadOnlySourcePreview from "~/components/files/ReadOnlySourcePreview";
import { useFileLineReveal } from "~/components/files/useFileLineReveal";
import { Button } from "~/components/ui/button";
import { useTheme } from "~/hooks/useTheme";
import {
  buildContentCacheKey,
  buildPatchCacheKey,
  getDiffCollapseIconClassName,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { cn } from "~/lib/utils";

import {
  buildCodeViewDiffFiles,
  codeViewPatchPath,
  createCodeViewContentsLoader,
  parseCodeViewPatch,
} from "./hostCodeView.logic";

/** `ClientHost.codeView.Diff`: the native Diff panel's viewer over a plugin's patch. */
export function HostCodeDiff(props: CodeViewDiffProps) {
  const { resolvedTheme } = useTheme();
  const {
    patch,
    collapsedPaths,
    onToggleCollapsed,
    reveal,
    loadContents,
    fileActions,
    onFileAction,
  } = props;
  const renderable = useMemo(
    () => parseCodeViewPatch(patch, resolvedTheme),
    [patch, resolvedTheme],
  );
  // Plugins rebuild the fold list every render; key on its contents so an
  // unrelated plugin re-render hands the viewer the same items.
  const collapsedKey = collapsedPaths?.join("\u0000") ?? "";
  const files = useMemo(
    () =>
      buildCodeViewDiffFiles(
        renderable?.kind === "files" ? renderable.files : [],
        collapsedKey === "" ? [] : collapsedKey.split("\u0000"),
      ),
    [renderable, collapsedKey],
  );
  const items = useMemo(() => files.map((file) => file.item), [files]);
  // Plugins rarely memoize callbacks; a fresh loader identity per render would
  // hand the viewer new options every time, so read the latest one via a ref.
  const latestLoadContents = useRef(loadContents);
  useEffect(() => {
    latestLoadContents.current = loadContents;
  });
  const contentsCacheScope = useMemo(
    () => buildPatchCacheKey(patch, "extension-code-view"),
    [patch],
  );
  const loadThroughLatest = useCallback<FileDiffContentsLoader>(
    (fileDiff) =>
      createCodeViewContentsLoader((path) => {
        const load = latestLoadContents.current;
        return load ? load(path) : Promise.reject(new Error("Contents are unavailable"));
      }, contentsCacheScope)(fileDiff),
    [contentsCacheScope],
  );
  const loadDiffFiles = loadContents === undefined ? undefined : loadThroughLatest;
  const [viewer, setViewer] = useState<CodeViewHandle<undefined> | null>(null);
  const requestReveal = useCodeViewFileReveal(viewer, patch);
  // One scroll per request id; later fold or content changes must not re-scroll.
  const handledRevealId = useRef<number | null>(null);
  const revealPath = reveal?.path;
  const revealRequestId = reveal?.requestId;
  useEffect(() => {
    if (revealRequestId === undefined || handledRevealId.current === revealRequestId) return;
    const target = files.find((file) => file.path === revealPath);
    if (!target) return;
    handledRevealId.current = revealRequestId;
    requestReveal(target.item.id);
  }, [files, revealPath, revealRequestId, requestReveal]);

  if (renderable === null) return null;
  if (renderable.kind === "raw") {
    return (
      <div className={cn("min-h-0 flex-1 overflow-auto p-2", props.className)}>
        <p className="text-2xs text-muted-foreground/75">{renderable.reason}</p>
        <pre
          className={cn(
            "rounded-md border border-border/70 bg-background/70 p-3 font-mono text-2xs leading-relaxed text-muted-foreground/90",
            props.wordWrap ? "whitespace-pre-wrap wrap-break-word" : "overflow-auto",
          )}
        >
          {renderable.text}
        </pre>
      </div>
    );
  }

  return (
    <StyledDiffCodeView
      className={cn("min-h-0 flex-1 overflow-auto", props.className)}
      viewerRef={setViewer}
      items={items}
      {...(onToggleCollapsed
        ? {
            renderHeaderPrefix: (item: CodeViewItem<undefined>) => {
              if (item.type !== "diff") return null;
              const path = codeViewPatchPath(item.fileDiff);
              const folded = item.collapsed === true;
              const Icon = folded ? ChevronRightIcon : ChevronDownIcon;
              return (
                <Button
                  size="icon-micro"
                  variant="ghost"
                  className="-ms-0.5"
                  aria-label={folded ? `Expand ${path}` : `Collapse ${path}`}
                  aria-expanded={!folded}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleCollapsed(path);
                  }}
                >
                  <Icon className={cn("size-4", getDiffCollapseIconClassName(item.fileDiff))} />
                </Button>
              );
            },
          }
        : {})}
      {...(fileActions && fileActions.length > 0 && onFileAction
        ? {
            renderHeaderFilenameSuffix: (item: CodeViewItem<undefined>) => {
              if (item.type !== "diff") return null;
              const path = codeViewPatchPath(item.fileDiff);
              return fileActions.map((action) => (
                <Button
                  key={action.id}
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    onFileAction(action.id, path);
                  }}
                >
                  {action.label}
                </Button>
              ));
            },
          }
        : {})}
      options={{
        diffStyle: props.layout === "split" ? "split" : "unified",
        lineDiffType: "none",
        overflow: props.wordWrap ? "wrap" : "scroll",
        theme: resolveDiffThemeName(resolvedTheme),
        preferredHighlighter: PREFERRED_HIGHLIGHTER,
        themeType: resolvedTheme,
        stickyHeaders: true,
        // The loader reads the latest plugin callback only when the reader expands context.
        // oxlint-disable-next-line react/refs
        ...(loadDiffFiles ? { loadDiffFiles } : {}),
      }}
    />
  );
}

/** `ClientHost.codeView.File`: the native read-only source preview over a plugin's text. */
export function HostCodeFile(props: CodeViewFileProps) {
  const onPostRender = useFileLineReveal(
    props.path,
    props.reveal?.line ?? null,
    props.reveal?.requestId ?? 0,
  );
  const cacheKey = useMemo(
    // File lines are cached by this key, so edge whitespace must change it (unlike patches).
    () => buildContentCacheKey(props.contents, `extension-code-view:file:${props.path}`),
    [props.contents, props.path],
  );
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", props.className)}>
      <ReadOnlySourcePreview
        name={props.path}
        text={props.contents}
        cacheKey={cacheKey}
        onPostRender={onPostRender}
        {...(props.wordWrap === undefined ? {} : { wordWrap: props.wordWrap })}
      />
    </div>
  );
}
