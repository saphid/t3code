import {
  filePresentationApi,
  resourcesLeaseApi,
  textEditsApi,
  workspaceChangesApi,
  workspaceFilesApi,
  workspaceSearchApi,
  workspaceTreeApi,
  type WorkspaceTreeEvent,
} from "@t3tools/extension-sdk/catalogue";
import { defineExtension, requireApi } from "@t3tools/extension-sdk/authoring";
import { bindApi, bindStreamApi } from "@t3tools/extension-sdk/capabilities";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import type { ViewSession } from "@t3tools/extension-sdk/host";
import { useEffect, useMemo, useRef, useState } from "react";

import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from "./markdown.js";
import {
  FILE_SAVE_DEBOUNCE_MS,
  FileEditCoordinator,
  type EditorSaveState,
} from "./saveCoordinator.js";
import { useFileEditor } from "./editorSession.js";
import { useMutationRefresh, useWorkspaceChanges } from "./mutationRefresh.js";
import {
  contentMatchSegments,
  describeContentSearch,
  describeFileOpen,
  describeMediaLease,
  describePresentation,
  describeRead,
  describeSaveState,
  describeSearch,
  describeSnapshot,
  editorSavePending,
  fileOpenFailed,
  isMarkdownPath,
  leasePreviewMode,
  mediaLeaseAssetFailed,
  mediaLeaseExpire,
  mediaLeaseFailed,
  mediaLeaseKindGate,
  mediaLeaseMinted,
  mediaLeaseRenewalDelay,
  mediaLeaseRenewing,
  mediaLeaseUrl,
  selectMediaLease,
  parentPath,
  presentationPath,
  previewKind,
  toggleExpanded,
  visibleRows,
  type ContentSearchResults,
  type EditorOpen,
  type FileOpenState,
  type MediaLeaseState,
  type PreviewKind,
  type SearchKindFilter,
  type SearchResults,
  type TreeEntry,
} from "./viewModel.js";

const manifestId = "t3.files";
const PREVIEW_ASSET_PATH = "assets/preview.png";
const SEARCH_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 150;

function restoreState(value: unknown): value is { readonly relativePath: string } | null {
  if (value === null) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { relativePath?: unknown }).relativePath === "string"
  );
}

const emptyEntries: readonly TreeEntry[] = [];

/** Finite `t3.workspace/tree` snapshot consumed to completion, then swapped in. */
function useWorkspaceTree(host: ClientHost, session: ViewSession) {
  const [snapshot, setSnapshot] = useState<{
    entries: readonly TreeEntry[];
    status: string;
    revision: number;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [visible, setVisible] = useState(session.visible);
  useEffect(() => session.onVisibility(setVisible), [session]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void (async () => {
      try {
        const next: TreeEntry[] = [];
        let completed = false;
        let truncated = false;
        const stream = bindStreamApi(workspaceTreeApi, host, session.context).subscribe(
          "snapshot",
          {},
          signal,
        );
        for await (const frame of stream) {
          signal.throwIfAborted();
          const event: WorkspaceTreeEvent = frame.value;
          if (event.kind === "chunk") {
            if (event.entries.length > 200)
              throw new Error("Workspace tree chunk exceeded 200 entries.");
            next.push(...event.entries);
            if (next.length > 25000)
              throw new Error("Workspace tree exceeded the 25,000-entry limit.");
            truncated = truncated || event.truncated;
          } else if (event.kind === "complete") {
            if (event.entryCount !== next.length)
              throw new Error("Workspace tree snapshot count was inconsistent.");
            truncated = truncated || event.truncated;
            completed = true;
            break;
          } else throw new Error("Workspace tree returned an unknown snapshot event.");
        }
        if (!completed) throw new Error("Workspace tree snapshot ended before completion.");
        setSnapshot({
          entries: next,
          revision: refresh,
          status: truncated ? "Files ready (index truncated)" : "Files ready",
        });
      } catch (error) {
        if (!signal.aborted)
          setSnapshot((previous) => ({
            entries: previous?.entries ?? emptyEntries,
            revision: refresh,
            status: error instanceof Error ? error.message : "Workspace tree unavailable",
          }));
      }
    })();
    return () => controller.abort();
  }, [host, refresh, session, visible]);
  return {
    entries: snapshot?.entries ?? emptyEntries,
    status: snapshot?.revision === refresh ? snapshot.status : "Loading files",
    revision: refresh,
    visible,
    refresh: () => setRefresh((value) => value + 1),
  };
}

/**
 * Verified package-asset read (F2a path): `readAsset` re-resolves and
 * re-verifies bytes on every call, so a stale object URL is renewed by
 * re-running the effect rather than trusting a cached URL.
 */
function usePackageAsset(host: ClientHost, session: ViewSession, visible: boolean) {
  const [asset, setAsset] = useState<{ url: string; status: string } | null>(null);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    let url: string | null = null;
    void (async () => {
      try {
        if (!host.readAsset) throw new Error("This host cannot load package assets.");
        const result = await host.readAsset(PREVIEW_ASSET_PATH, signal);
        if (signal.aborted) return;
        url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: "image/png" }));
        setAsset({
          url,
          status: `Package asset verified — ${result.bytes.byteLength.toLocaleString("en-US")} bytes, sha256 ${result.sha256.slice(0, 12)}…`,
        });
      } catch (error) {
        if (!signal.aborted)
          setAsset({
            url: "",
            status: error instanceof Error ? error.message : "Package asset unavailable",
          });
      }
    })();
    return () => {
      controller.abort();
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [host, session, visible]);
  return asset;
}

/**
 * Workspace media preview via `t3.resources/lease` (F1 #8 + #24). Selecting a
 * previewable media file mints a signed `/api/assets/*` URL rendered
 * document-relative; the lease renews `MEDIA_LEASE_RENEWAL_SKEW_MS` before
 * expiry while visible, re-mints on tree refresh, and every named denial maps
 * to an explicit state — a broken element is never the error UI. The minted
 * URL resolves on the environment's own origin; a foreign-origin presentation
 * 404s the foreign-signed token and the element's load failure lands in the
 * named unavailable state instead of a broken image.
 */
function useMediaLease(
  host: ClientHost,
  session: ViewSession,
  selected: string | null,
  selectedKind: PreviewKind,
  refreshRevision: number,
  visible: boolean,
) {
  const active = selected !== null && selectedKind !== "text" && visible;
  const mode = selected === null ? null : leasePreviewMode(selected);
  const [lease, setLease] = useState<MediaLeaseState>({ status: "idle" });
  const leaseRef = useRef<MediaLeaseState>({ status: "idle" });
  const mintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const commitLease = (next: MediaLeaseState | ((prev: MediaLeaseState) => MediaLeaseState)) => {
      setLease((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        leaseRef.current = value;
        return value;
      });
    };
    mintRef.current = null;
    if (!active || selected === null) {
      commitLease({ status: "idle" });
      return;
    }
    const path = selected;
    const threadId = session.context.resource.threadId;
    const initial = selectMediaLease({
      path,
      hasThread: typeof threadId === "string" && threadId.length > 0,
    });
    commitLease(initial);
    if (initial.status !== "minting" || threadId === undefined) return;

    const api = bindApi(resourcesLeaseApi, host, session.context);
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    const clearRenewal = () => {
      if (renewalTimer !== undefined) {
        clearTimeout(renewalTimer);
        renewalTimer = undefined;
      }
    };

    const mint = async () => {
      try {
        const capabilities = await api.invoke("getCapabilities", {}, signal);
        if (signal.aborted) return;
        const gate = mediaLeaseKindGate(capabilities.supportedKinds);
        if (gate) {
          commitLease(gate);
          return;
        }
        const minted = await api.invoke(
          "createPresentationUrl",
          { resource: { _tag: "workspace-file", threadId, path } },
          signal,
        );
        if (signal.aborted) return;
        if (leasePreviewMode(path) === "document") {
          // An iframe does not reliably fire onerror for failed documents —
          // preflight the lease so a 404 lands in the named state. The frame
          // gets the minted URL itself: a blob: URL would be refused by
          // desktop's frame-src 'self' CSP. The route's private max-age cache
          // dedupes the frame's fetch on web; the t3code:// scheme has no
          // HTTP cache, so desktop re-fetches once through the local proxy.
          const response = await fetch(minted.url, { signal });
          if (signal.aborted) return;
          if (!response.ok) {
            commitLease(
              mediaLeaseAssetFailed(
                { status: "ready", url: minted.url, expiresAt: minted.expiresAt },
                Date.now(),
              ),
            );
            return;
          }
          await response.arrayBuffer();
          if (signal.aborted) return;
        }
        commitLease(mediaLeaseMinted(minted));
        clearRenewal();
        renewalTimer = setTimeout(
          () => {
            renewalTimer = undefined;
            commitLease((prev) => mediaLeaseRenewing(prev));
            void mint();
          },
          mediaLeaseRenewalDelay(minted.expiresAt, Date.now()),
        );
      } catch (error) {
        if (signal.aborted) return;
        const next = mediaLeaseFailed(error, leaseRef.current);
        commitLease(next);
        if (next.status === "ready") {
          // Renewal failed but the current lease still serves — re-arm at
          // expiresAt so the state goes expired and re-mints rather than
          // asserting a live lease past its TTL.
          clearRenewal();
          renewalTimer = setTimeout(
            () => {
              renewalTimer = undefined;
              commitLease((prev) => mediaLeaseExpire(prev));
              void mint();
            },
            Math.max(0, next.expiresAt - Date.now()),
          );
        }
      }
    };
    mintRef.current = mint;
    void mint();

    return () => {
      mintRef.current = null;
      clearRenewal();
      controller.abort();
    };
    // selectedKind gates via `active`; refreshRevision is an intentional
    // trigger — a tree refresh re-mints so refreshed bytes stay honest.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [host, session, selected, selectedKind, refreshRevision, active]);

  const notifyAssetFailed = () => {
    const previous = leaseRef.current;
    const next = mediaLeaseAssetFailed(previous, Date.now());
    if (next === previous) return;
    leaseRef.current = next;
    setLease(next);
    if (next.status === "expired") mintRef.current?.();
  };

  return { state: lease, mode, url: mediaLeaseUrl(lease), notifyAssetFailed };
}

const HEADING_SIZE: readonly number[] = [0, 22, 18, 16, 14, 13, 12];

/** Short content digest — enough for sibling-unique, rerender-stable keys. */
function nodeDigest(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return hash.toString(36);
}

/**
 * Data-derived keys for rendered node lists: content digest plus the
 * occurrence count among identical siblings. Stable across re-parses of the
 * same source and unique without positional index keys.
 */
function keyed<T>(items: readonly T[], keyOf: (item: T) => string) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { item, key: `${base}#${occurrence}` };
  });
}

/** One inline markdown node → a host-React element. */
function MarkdownInlineNode(props: { readonly node: MarkdownInline }) {
  const node = props.node;
  switch (node.type) {
    case "text":
      return node.text;
    case "code":
      return (
        <code
          style={{
            fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
            fontSize: "0.92em",
            background: "var(--muted, #f2f4f7)",
            borderRadius: 4,
            padding: "0 3px",
          }}
        >
          {node.text}
        </code>
      );
    case "strong":
      return (
        <strong>
          <MarkdownInlines nodes={node.children} />
        </strong>
      );
    case "em":
      return (
        <em>
          <MarkdownInlines nodes={node.children} />
        </em>
      );
    case "delete":
      return (
        <del>
          <MarkdownInlines nodes={node.children} />
        </del>
      );
    case "link":
      return node.safe ? (
        <a href={node.href} target="_blank" rel="noreferrer">
          <MarkdownInlines nodes={node.children} />
        </a>
      ) : (
        // Unsafe/relative destinations stay visible but never navigable.
        <span>
          <MarkdownInlines nodes={node.children} /> ({node.href})
        </span>
      );
    case "image":
      return (
        <span style={{ color: "var(--muted-foreground, #667085)" }}>
          [image: {node.alt || node.src}]
        </span>
      );
    case "break":
      return <br />;
  }
}

/**
 * Inline markdown → host-React elements. Every text node is escaped by React;
 * the only attribute ever emitted is `href` on a safe-scheme anchor, so the
 * markup source has no injection surface at all.
 */
function MarkdownInlines(props: { readonly nodes: readonly MarkdownInline[] }) {
  return keyed(props.nodes, (node) => `i:${nodeDigest(node)}`).map(({ item, key }) => (
    <MarkdownInlineNode key={key} node={item} />
  ));
}

/** One block → host-React elements; plain elements only, no raw HTML. */
function MarkdownBlockNode(props: { readonly block: MarkdownBlock }) {
  const block = props.block;
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag
          style={{
            fontSize: HEADING_SIZE[block.level],
            fontWeight: 600,
            margin: "14px 0 6px",
          }}
        >
          <MarkdownInlines nodes={block.children} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p style={{ margin: "0 0 10px" }}>
          <MarkdownInlines nodes={block.children} />
        </p>
      );
    case "code":
      return (
        <figure style={{ margin: "0 0 10px" }}>
          {block.info !== "" && (
            <figcaption
              style={{
                color: "var(--muted-foreground, #667085)",
                fontSize: 11,
                marginBottom: 2,
              }}
            >
              {block.info}
            </figcaption>
          )}
          <pre
            style={{
              margin: 0,
              padding: 10,
              overflow: "auto",
              background: "var(--muted, #f2f4f7)",
              borderRadius: 6,
              fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
              fontSize: 12,
            }}
          >
            <code>{block.text}</code>
          </pre>
        </figure>
      );
    case "quote":
      return (
        <blockquote
          style={{
            margin: "0 0 10px",
            paddingLeft: 12,
            borderLeft: "3px solid var(--border, #dfe3e8)",
            color: "var(--muted-foreground, #667085)",
          }}
        >
          <MarkdownBlocks blocks={block.children} />
        </blockquote>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag style={{ margin: "0 0 10px", paddingLeft: 24 }}>
          {keyed(block.items, (item) => `li:${nodeDigest(item)}`).map(({ item, key }) => (
            <li key={key} style={{ marginBottom: 4 }}>
              {item.task !== undefined && (
                <input
                  type="checkbox"
                  checked={item.task.checked}
                  disabled
                  readOnly
                  aria-label={item.task.checked ? "Completed task" : "Incomplete task"}
                  style={{ marginRight: 6 }}
                />
              )}
              <MarkdownBlocks blocks={item.children} />
            </li>
          ))}
        </ListTag>
      );
    }
    case "rule":
      return (
        <hr
          style={{ border: 0, borderTop: "1px solid var(--border, #dfe3e8)", margin: "14px 0" }}
        />
      );
  }
}

/**
 * Block tree → host-React elements for the rendered-markdown preview (F1 #22).
 * Plain elements only — no raw HTML, no user-controlled attributes.
 */
function MarkdownBlocks(props: { readonly blocks: readonly MarkdownBlock[] }) {
  return keyed(props.blocks, (block) => `b:${nodeDigest(block)}`).map(({ item, key }) => (
    <MarkdownBlockNode key={key} block={item} />
  ));
}

/** The rendered-markdown surface: block view plus the named-subset caption. */
function RenderedMarkdown(props: { readonly blocks: readonly MarkdownBlock[] }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12 }}>
      <article
        aria-label="Rendered markdown"
        style={{ lineHeight: 1.55, overflowWrap: "break-word" }}
      >
        <MarkdownBlocks blocks={props.blocks} />
      </article>
      <footer style={{ color: "var(--muted-foreground, #667085)", fontSize: 11, marginTop: 12 }}>
        Rendered preview — markdown subset (raw HTML, tables and images are not rendered; task lists
        are read-only)
      </footer>
    </div>
  );
}

function FilesView(props: { host: ClientHost; session: ViewSession }) {
  const { host, session } = props;
  const { entries, status, refresh, revision, visible } = useWorkspaceTree(host, session);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"names" | "contents">("names");
  const [kindFilter, setKindFilter] = useState<SearchKindFilter>("all");
  const [search, setSearch] = useState<{
    key: string;
    outcome:
      | { mode: "names"; results: SearchResults | null; error: string | null }
      | { mode: "contents"; results: ContentSearchResults | null; error: string | null };
  } | null>(null);
  const restoredPath =
    session.restoreState &&
    typeof session.restoreState === "object" &&
    !Array.isArray(session.restoreState)
      ? (session.restoreState as { readonly relativePath?: unknown }).relativePath
      : null;
  const [selected, setSelected] = useState<string | null>(
    typeof restoredPath === "string" ? restoredPath : null,
  );
  const [read, setRead] = useState<{
    relativePath: string;
    revision: number;
    contents: string;
    status: string;
    truncated: boolean;
  } | null>(null);
  const selectedKind: PreviewKind = selected ? previewKind(selected) : "text";
  const editor = useFileEditor(host, session, selected, selectedKind, revision, visible);
  const media = useMediaLease(host, session, selected, selectedKind, revision, visible);
  const packageAsset = usePackageAsset(
    host,
    session,
    visible && selected !== null && selectedKind !== "text",
  );
  const currentRead = read?.relativePath === selected && read.revision === revision ? read : null;
  const changes = useWorkspaceChanges(host, session, visible);
  // Native parity: a bump while the selected file's save state is latched
  // (dirty/saving/conflict/error) stays pending instead of clobbering local
  // edits; when the latch opens the pending seq fires one catch-up refresh.
  const savePending =
    editor.surface?.path === selected &&
    editor.surface !== null &&
    editorSavePending(editor.surface.saveState.kind);
  useMutationRefresh({
    mutationSeq: changes.mutationSeq,
    enabled: visible && !savePending,
    refresh,
  });
  const kindByPath = useMemo(() => new Map(entries.map((e) => [e.path, e.kind])), [entries]);
  const searching = query.trim() !== "";
  const rows = useMemo(() => visibleRows(entries, expanded, ""), [entries, expanded]);
  const [fileOpen, setFileOpen] = useState<{ path: string; state: FileOpenState } | null>(null);
  // Rendered-vs-source is a preference, not a property of one file — the same
  // shape as the native panel's localStorage flag, kept in view state only.
  const [renderMarkdown, setRenderMarkdown] = useState(false);
  useEffect(() => {
    const needle = query.trim();
    if (!needle || !visible) return;
    const key = `${searchMode} ${needle} ${kindFilter} ${revision}`;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    const timer = setTimeout(() => {
      const api = bindApi(workspaceSearchApi, host, session.context);
      if (searchMode === "contents") {
        // The contents contract has no kind field — the selector is disabled
        // in this mode rather than silently ignored (F1 #7b).
        void api.invoke("searchContents", { query: needle, limit: SEARCH_LIMIT }, signal).then(
          (result) => {
            if (!signal.aborted)
              setSearch({ key, outcome: { mode: "contents", results: result, error: null } });
          },
          (error) => {
            if (!signal.aborted)
              setSearch({
                key,
                outcome: {
                  mode: "contents",
                  results: null,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Workspace contents search unavailable",
                },
              });
          },
        );
        return;
      }
      void api
        .invoke(
          "search",
          {
            query: needle,
            limit: SEARCH_LIMIT,
            ...(kindFilter === "all" ? {} : { kind: kindFilter }),
          },
          signal,
        )
        .then(
          (result) => {
            if (!signal.aborted)
              setSearch({ key, outcome: { mode: "names", results: result, error: null } });
          },
          (error) => {
            if (!signal.aborted)
              setSearch({
                key,
                outcome: {
                  mode: "names",
                  results: null,
                  error: error instanceof Error ? error.message : "Workspace search unavailable",
                },
              });
          },
        );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [host, session, query, kindFilter, searchMode, revision, visible]);
  const activeSearch =
    searching && search?.key === `${searchMode} ${query.trim()} ${kindFilter} ${revision}`
      ? search
      : null;

  const select = (path: string) => {
    setSelected(path);
    session.save({ relativePath: path });
    const ancestors: string[] = [];
    for (let ancestor = parentPath(path); ancestor !== null; ancestor = parentPath(ancestor))
      ancestors.push(ancestor);
    if (ancestors.length) setExpanded((previous) => new Set([...previous, ...ancestors]));
  };

  // F1 #17: the public open path is `t3.file/presentation.open` — the host's
  // provider selection is the picker, so this resolves the descriptor and
  // reports it (or the named failure) verbatim. Requires stays without the
  // self-provided API: files provides t3.file/presentation, and a
  // self-requirement would trip the resolver's cyclic-dependency check.
  const openInPresentation = () => {
    if (selected === null) return;
    const path = presentationPath(selected);
    if (path === null) {
      setFileOpen({
        path: selected,
        state: {
          status: "unavailable",
          message: `${selected} cannot be opened — not a workspace-relative path`,
        },
      });
      return;
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    setFileOpen({ path, state: { status: "resolving" } });
    void bindApi(filePresentationApi, host, session.context)
      .invoke("open", { relativePath: path }, signal)
      .then(
        (result) => {
          if (!signal.aborted)
            setFileOpen({
              path,
              state: { status: "resolved", message: describePresentation(result) },
            });
        },
        (error) => {
          if (!signal.aborted) setFileOpen({ path, state: fileOpenFailed(error) });
        },
      )
      .finally(() => controller.abort());
  };

  const editorSurface = editor.surface?.path === selected ? editor.surface : null;
  // F1 #22: rendered markdown draws from the buffer the surface already read —
  // the live editor contents when editable, else the bounded preview read.
  const markdownText =
    selected !== null && isMarkdownPath(selected)
      ? ((editorSurface?.open.editable === true ? editorSurface.contents : currentRead?.contents) ??
        null)
      : null;
  const markdownBlocks = useMemo(
    () => (renderMarkdown && markdownText !== null ? parseMarkdown(markdownText) : null),
    [renderMarkdown, markdownText],
  );

  useEffect(() => {
    // The bounded preview read remains the fallback for files the text-edits
    // contract reports as not-editable (oversized/binary/non-UTF-8) — shown
    // read-only with the named reason, never silently editable.
    if (!selected || !visible || selectedKind !== "text") return;
    if (editorSurface === null || editorSurface.open.editable) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, session.signal]);
    void bindApi(workspaceFilesApi, host, session.context)
      .invoke("readText", { relativePath: selected }, signal)
      .then(
        (value) => {
          if (!signal.aborted) {
            const described = describeRead(value);
            setRead({
              relativePath: selected,
              revision,
              contents: value.contents,
              status: described.status,
              truncated: described.truncated,
            });
          }
        },
        (error) => {
          if (!signal.aborted)
            setRead({
              relativePath: selected,
              revision,
              contents: "",
              status: error instanceof Error ? error.message : "File unavailable",
              truncated: false,
            });
        },
      );
    return () => controller.abort();
  }, [host, selected, selectedKind, session, revision, visible, editorSurface]);

  const muted = "var(--muted-foreground, #667085)";
  return (
    <section
      aria-label="Files"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        color: "var(--foreground, #20252d)",
        background: "var(--background, #fff)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        fontSize: 13,
      }}
    >
      <header
        style={{
          display: "flex",
          gap: 6,
          padding: 8,
          borderBottom: "1px solid var(--border, #dfe3e8)",
          flexShrink: 0,
        }}
      >
        <button type="button" onClick={refresh}>
          Refresh files
        </button>
        <select
          aria-label="Search mode"
          value={searchMode}
          onChange={(event) => setSearchMode(event.target.value as "names" | "contents")}
        >
          <option value="names">File names</option>
          <option value="contents">File contents</option>
        </select>
        <input
          type="search"
          aria-label="Search workspace files"
          placeholder={searchMode === "contents" ? "Search file contents" : "Search files"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              event.currentTarget.blur();
            }
          }}
          style={{ flex: 1, minWidth: 0 }}
        />
        <select
          aria-label={
            searchMode === "contents" ? "Search kind — not used for contents search" : "Search kind"
          }
          value={kindFilter}
          disabled={searchMode === "contents"}
          onChange={(event) => setKindFilter(event.target.value as SearchKindFilter)}
        >
          <option value="all">All</option>
          <option value="file">Files</option>
          <option value="directory">Directories</option>
        </select>
      </header>
      <ul
        aria-label="Workspace files"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 6,
          overflow: "auto",
          flex: 1,
          minHeight: 0,
        }}
      >
        {searching
          ? activeSearch?.outcome.mode === "contents"
            ? keyed(
                activeSearch.outcome.results?.matches ?? [],
                (match) => `${match.path}:${match.lineNumber}`,
              ).map(({ item: match, key }) => (
                <li key={key}>
                  <button
                    type="button"
                    aria-current={match.path === selected ? "true" : undefined}
                    onClick={() => select(match.path)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      font: "inherit",
                      fontSize: 12,
                      padding: "4px 6px",
                      border: "1px solid transparent",
                      borderRadius: 5,
                      cursor: "pointer",
                      color: "var(--foreground, #20252d)",
                      background:
                        match.path === selected ? "var(--accent, #e8eef7)" : "transparent",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        color: muted,
                        fontSize: 11,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {match.path}:{match.lineNumber}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontFamily:
                          "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {keyed(
                        contentMatchSegments(match.lineContent, match.matchRanges),
                        (segment) => `s:${segment.match}:${nodeDigest(segment.text)}`,
                      ).map(({ item: segment, key: segmentKey }) =>
                        segment.match ? (
                          <mark
                            key={segmentKey}
                            style={{ background: "var(--accent, #e8eef7)", color: "inherit" }}
                          >
                            {segment.text}
                          </mark>
                        ) : (
                          <span key={segmentKey}>{segment.text}</span>
                        ),
                      )}
                    </span>
                  </button>
                </li>
              ))
            : (activeSearch?.outcome.mode === "names"
                ? (activeSearch.outcome.results?.entries ?? [])
                : []
              ).map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    aria-current={entry.path === selected ? "true" : undefined}
                    onClick={() =>
                      entry.kind === "directory"
                        ? (setQuery(""),
                          setExpanded((previous) => {
                            const next = new Set(previous);
                            for (
                              let ancestor: string | null = entry.path;
                              ancestor !== null;
                              ancestor = parentPath(ancestor)
                            )
                              next.add(ancestor);
                            return next;
                          }))
                        : select(entry.path)
                    }
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      font: "inherit",
                      fontSize: 12,
                      padding: "4px 6px",
                      border: "1px solid transparent",
                      borderRadius: 5,
                      cursor: "pointer",
                      color: "var(--foreground, #20252d)",
                      background:
                        entry.path === selected ? "var(--accent, #e8eef7)" : "transparent",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.kind === "directory" ? "▸ " : ""}
                    {entry.path}
                  </button>
                </li>
              ))
          : rows.map((row) => (
              <li key={row.entry.path}>
                <button
                  type="button"
                  aria-expanded={row.expandable ? expanded.has(row.entry.path) : undefined}
                  aria-current={row.entry.path === selected ? "true" : undefined}
                  onClick={() =>
                    row.expandable
                      ? setExpanded((previous) => toggleExpanded(previous, row.entry.path))
                      : select(row.entry.path)
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    font: "inherit",
                    fontSize: 12,
                    padding: "4px 6px",
                    paddingLeft: 6 + row.depth * 14,
                    border: "1px solid transparent",
                    borderRadius: 5,
                    cursor: "pointer",
                    color: "var(--foreground, #20252d)",
                    background:
                      row.entry.path === selected ? "var(--accent, #e8eef7)" : "transparent",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.expandable ? (expanded.has(row.entry.path) ? "▾ " : "▸ ") : ""}
                  {row.entry.path.split("/").at(-1)}
                  {row.expandable ? "/" : ""}
                </button>
              </li>
            ))}
      </ul>
      <output aria-label="Tree status" style={{ padding: "6px 10px", color: muted, fontSize: 11 }}>
        {(searching
          ? (activeSearch?.outcome.error ??
            (searchMode === "contents"
              ? describeContentSearch(
                  activeSearch?.outcome.mode === "contents" ? activeSearch.outcome.results : null,
                  query,
                  SEARCH_LIMIT,
                )
              : describeSearch(
                  activeSearch?.outcome.mode === "names" ? activeSearch.outcome.results : null,
                  query,
                  SEARCH_LIMIT,
                )))
          : status + (kindByPath.size > 0 ? ` — ${entries.length} entries` : "")) +
          (changes.status === "degraded" ? " · agent updates unavailable — use Refresh files" : "")}
      </output>
      {selected && (
        <output
          aria-label="File status"
          style={{ padding: "6px 10px", color: muted, fontSize: 11 }}
        >
          {selected +
            ": " +
            (selectedKind === "text"
              ? editorSurface === null
                ? "Reading file"
                : editorSurface.open.editable
                  ? describeSaveState(editorSurface.saveState)
                  : editorSurface.open.message + (currentRead ? ` — ${currentRead.status}` : "")
              : describeMediaLease(media.state))}
        </output>
      )}
      {selected && (
        <div
          role="toolbar"
          aria-label="File actions"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "4px 10px",
            borderTop: "1px solid var(--border, #dfe3e8)",
            flexShrink: 0,
          }}
        >
          <button type="button" onClick={openInPresentation}>
            Open in…
          </button>
          {isMarkdownPath(selected) && selectedKind === "text" && (
            <button
              type="button"
              aria-pressed={renderMarkdown}
              onClick={() => setRenderMarkdown((value) => !value)}
            >
              {renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
            </button>
          )}
          {fileOpen !== null && fileOpen.path === selected && fileOpen.state.status !== "idle" && (
            <span style={{ color: muted, fontSize: 11 }}>{describeFileOpen(fileOpen.state)}</span>
          )}
        </div>
      )}
      {selected && selectedKind === "text" && editorSurface?.open.editable === true && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            borderTop: "1px solid var(--border, #dfe3e8)",
          }}
        >
          {markdownBlocks !== null ? (
            <RenderedMarkdown blocks={markdownBlocks} />
          ) : (
            <textarea
              aria-label="File editor"
              value={editorSurface.contents}
              onChange={(event) => editor.change(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") event.currentTarget.blur();
              }}
              spellCheck={false}
              style={{
                flex: 1,
                minHeight: 0,
                resize: "none",
                border: "none",
                outline: "none",
                padding: 12,
                color: "inherit",
                background: "transparent",
                fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
                fontSize: 12,
              }}
            />
          )}
          {editorSurface.saveState.kind === "conflict" && (
            <div
              role="alert"
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                padding: "6px 10px",
                borderTop: "1px solid var(--border, #dfe3e8)",
                fontSize: 11,
                color: "var(--foreground, #20252d)",
              }}
            >
              File changed on disk — your edits are kept.
              <button type="button" onClick={editor.reload}>
                Reload file
              </button>
              <button type="button" onClick={editor.keepMine}>
                Keep my version
              </button>
            </div>
          )}
          {editorSurface.saveState.kind === "error" && (
            <div
              role="alert"
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                padding: "6px 10px",
                borderTop: "1px solid var(--border, #dfe3e8)",
                fontSize: 11,
                color: "var(--foreground, #20252d)",
              }}
            >
              {describeSaveState(editorSurface.saveState)}
              <button type="button" onClick={editor.retry}>
                Retry save
              </button>
            </div>
          )}
        </div>
      )}
      {selected &&
        selectedKind === "text" &&
        editorSurface !== null &&
        !editorSurface.open.editable &&
        (markdownBlocks !== null ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              borderTop: "1px solid var(--border, #dfe3e8)",
            }}
          >
            <RenderedMarkdown blocks={markdownBlocks} />
          </div>
        ) : (
          <pre
            aria-label="File contents"
            style={{
              overflow: "auto",
              flex: 1,
              margin: 0,
              padding: 12,
              borderTop: "1px solid var(--border, #dfe3e8)",
              fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)",
              fontSize: 12,
            }}
          >
            {currentRead?.contents ?? ""}
          </pre>
        ))}
      {selected && selectedKind !== "text" && (
        <figure
          aria-label="Workspace media preview"
          style={{
            margin: 0,
            padding: 12,
            borderTop: "1px solid var(--border, #dfe3e8)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {media.mode === "image" && media.url !== null ? (
            <img
              src={media.url}
              alt={selected.split("/").at(-1)}
              onError={media.notifyAssetFailed}
              style={{ maxWidth: "100%", objectFit: "contain", alignSelf: "flex-start" }}
            />
          ) : null}
          {media.mode === "document" && media.url !== null ? (
            // The built-in PDF viewer needs an unsandboxed frame — parity with
            // the native FilePreviewPanel; the lease only serves workspace-owned bytes.
            // oxlint-disable-next-line react/iframe-missing-sandbox
            <iframe
              src={media.url}
              title={selected.split("/").at(-1)}
              style={{ flex: 1, minHeight: 0, width: "100%", border: 0, background: "#fff" }}
            />
          ) : null}
        </figure>
      )}
      {selected && selectedKind !== "text" && (
        <figure
          aria-label="Package asset preview"
          style={{
            margin: 0,
            padding: 12,
            borderTop: "1px solid var(--border, #dfe3e8)",
            display: "grid",
            gap: 8,
            justifyItems: "start",
          }}
        >
          {packageAsset?.url ? (
            <img
              src={packageAsset.url}
              alt="Verified package asset rendered through the public asset surface"
              style={{ imageRendering: "pixelated", width: 64, height: 64 }}
            />
          ) : null}
          <figcaption style={{ color: muted, fontSize: 11 }}>
            {packageAsset?.status ?? "Loading package asset"}
          </figcaption>
        </figure>
      )}
    </section>
  );
}

export default defineExtension({
  id: manifestId,
  version: "0.6.0",
  provides: [filePresentationApi.definition],
  assets: [{ path: PREVIEW_ASSET_PATH, mediaType: "application/octet-stream" }],
  serverEntry: "server.ts",
  requires: [
    requireApi(workspaceTreeApi),
    requireApi(workspaceFilesApi),
    requireApi(workspaceSearchApi),
    requireApi(workspaceChangesApi),
    requireApi(textEditsApi),
    requireApi(resourcesLeaseApi),
  ],
  surfaces: [
    {
      name: "view",
      title: "Files",
      scope: "project",
      placements: ["side-panel"],
      clients: ["web", "desktop"],
      capabilities: [],
      stateVersion: 1,
      validateRestore: restoreState,
      createView(host, session) {
        return { renderer: () => <FilesView host={host} session={session} /> };
      },
    },
  ],
});
