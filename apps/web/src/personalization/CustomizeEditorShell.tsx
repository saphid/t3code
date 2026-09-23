import type { ReactNode } from "react";

import { Button } from "../components/ui/button";
import { PopoverTitle } from "../components/ui/popover";

/**
 * The visual frame shared by every customize editor, matching the thread
 * details panel's editor. Content-only: the caller renders it inside its own
 * `Popover`/`PopoverPopup` and handles dismissal through `onOpenChange`, so
 * Escape and outside click discard the draft without any handling here.
 */
export function CustomizeEditorShell(props: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly onReset: () => void;
  readonly resetDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div>
        <PopoverTitle>{props.title}</PopoverTitle>
        {props.description !== undefined ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{props.description}</p>
        ) : null}
      </div>

      <div className="max-h-[min(60vh,480px)] overflow-y-auto">{props.children}</div>

      <div className="flex items-center justify-between gap-2 border-t border-border/65 pt-3">
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={props.resetDisabled}
          onClick={props.onReset}
        >
          Reset to recommended
        </Button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="xs" variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button size="xs" onClick={props.onDone}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
