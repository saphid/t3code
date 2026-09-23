import type { ReactNode } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";

/**
 * One row in a customize editor's list: a label with an optional description,
 * a trailing control, and move buttons for user-ordered rows. The thread
 * details panel does not use it yet; a later task moves it over.
 */
export function CustomizeListRow(props: {
  readonly label: string;
  readonly description?: string;
  readonly control?: ReactNode;
  readonly onMoveUp?: () => void;
  readonly onMoveDown?: () => void;
  /** Replaces the control slot with the reason and dims the row. */
  readonly unavailableReason?: string;
  /** No move buttons; the trailing slot reads "Always shown". */
  readonly fixed?: boolean;
}) {
  const unavailable = props.unavailableReason !== undefined;
  return (
    <div className={cn("flex h-9 items-center gap-2 rounded-lg px-2", unavailable && "opacity-55")}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{props.label}</div>
        {props.description !== undefined ? (
          <div className="truncate text-[11px] text-muted-foreground">{props.description}</div>
        ) : null}
      </div>
      {unavailable ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {props.unavailableReason}
        </span>
      ) : props.fixed ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">Always shown</span>
      ) : props.control !== undefined ? (
        <div className="flex shrink-0 items-center">{props.control}</div>
      ) : null}
      {props.fixed ? null : (
        <div className="flex shrink-0 items-center">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Move ${props.label} up`}
            disabled={props.onMoveUp === undefined}
            onClick={props.onMoveUp}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Move ${props.label} down`}
            disabled={props.onMoveDown === undefined}
            onClick={props.onMoveDown}
          >
            <ChevronDownIcon />
          </Button>
        </div>
      )}
    </div>
  );
}
