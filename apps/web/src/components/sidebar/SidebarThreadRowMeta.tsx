import { Fragment, memo, type ReactNode } from "react";

import type { ThreadRowFieldId } from "./threadRowPreference";

/**
 * Nodes for the enabled glyph fields, in the user's field order. Used by the
 * card's second line and by compact rows, which share the same ordering rule.
 */
export function glyphNodesInOrder(
  fields: readonly ThreadRowFieldId[],
  nodes: Readonly<Partial<Record<ThreadRowFieldId, ReactNode | null>>>,
): ReactNode[] {
  const rendered: ReactNode[] = [];
  for (const id of fields) {
    const node = nodes[id];
    if (node !== undefined && node !== null) {
      rendered.push(<Fragment key={id}>{node}</Fragment>);
    }
  }
  return rendered;
}

/**
 * The card row's second line: branch, glyph fields, diff, and the trailing
 * remote/provider cluster. Extracted from `SidebarThreadRow` so the field set
 * is one prop: `fields` arrives resolved once per sidebar list (same array
 * reference for every row), and disabled fields simply do not render.
 */
export const SidebarThreadRowMeta = memo(function SidebarThreadRowMeta(props: {
  fields: readonly ThreadRowFieldId[];
  /** The existing <ThreadWorktreeIndicator/> + <MiddleTruncate/> pair, or null. */
  branch: ReactNode | null;
  terminal: ReactNode | null;
  pullRequest: ReactNode | null;
  environment: ReactNode | null;
  provider: ReactNode | null;
  /** Kept as a seam; the diff span renders even though it is always null today. */
  diff: ReactNode | null;
}) {
  const { fields } = props;
  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-secondary-label text-xs">
      {fields.includes("branch") && props.branch !== null ? (
        // Always the branch. The plan step used to take this slot while
        // working, but it truncated to a half-sentence and dropped the
        // branch, so the row lost its most stable identifier.
        props.branch
      ) : (
        <span className="flex-1" />
      )}
      {glyphNodesInOrder(fields, { terminal: props.terminal, pullRequest: props.pullRequest })}
      {props.diff}
      <span
        aria-hidden
        className="pointer-events-none ml-auto inline-flex shrink-0 items-center gap-1"
      >
        {glyphNodesInOrder(fields, { environment: props.environment, provider: props.provider })}
      </span>
    </div>
  );
});
