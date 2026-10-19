import { PencilIcon } from "lucide-react";

import { CustomizeEditorShell } from "../../personalization/CustomizeEditorShell";
import { CustomizeListRow } from "../../personalization/CustomizeListRow";
import { mergeOrderedItems } from "../../personalization/orderedItems";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { cn } from "../../lib/utils";
import {
  DEFAULT_THREAD_ROW_FIELDS,
  isRecommendedThreadRows,
  moveThreadRowField,
  THREAD_ROW_FIELDS,
  toggleThreadRowField,
  type ThreadRowFieldId,
} from "./threadRowPreference";

export interface ThreadRowFieldsValue {
  readonly density: "comfortable" | "compact";
  readonly fields: readonly string[] | null;
}

/**
 * The sidebar thread rows customize editor. Controlled: `value` is the live
 * draft the caller previews on the rows while the popover is open; Done and
 * Cancel/dismissal are the caller's decisions, exactly as the thread details
 * panel's editor does it.
 */
export function ThreadRowCustomizeEditor(props: {
  readonly open: boolean;
  readonly value: ThreadRowFieldsValue;
  readonly onChange: (value: ThreadRowFieldsValue) => void;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const savedFields = props.value.fields;
  const isFieldEnabled = (id: ThreadRowFieldId) =>
    savedFields === null || savedFields.includes(id);

  return (
    <Popover onOpenChange={props.onOpenChange} open={props.open}>
      <PopoverTrigger
        render={
          <span
            className={cn(
              "flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/sidebar-header:opacity-100 group-hover/sidebar-header:opacity-100 has-[:focus-visible]:opacity-100",
              props.open && "opacity-100",
            )}
          >
            <Button aria-label="Customize thread rows" size="icon-xs" variant="ghost">
              <PencilIcon className="size-3.5" />
            </Button>
          </span>
        }
      />
      <PopoverPopup align="end" width="md">
        <CustomizeEditorShell
          description="Choose row density and the details shown on active threads. Everything stays in the hover details."
          resetDisabled={isRecommendedThreadRows(props.value.density, props.value.fields)}
          title="Customize thread rows"
          onCancel={props.onCancel}
          onDone={props.onDone}
          onReset={() => props.onChange({ density: "comfortable", fields: null })}
        >
          <div className="flex flex-col gap-3">
            <div>
              <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">Density</p>
              <ToggleGroup
                aria-label="Thread row density"
                value={[props.value.density]}
                variant="segmented"
                onValueChange={(next) => {
                  const selected = next[0];
                  if (selected === "comfortable" || selected === "compact") {
                    props.onChange({ ...props.value, density: selected });
                  }
                }}
              >
                <Toggle value="comfortable">Comfortable</Toggle>
                <Toggle value="compact">Compact</Toggle>
              </ToggleGroup>
              <p className="mt-1 px-1 text-[11px] text-muted-foreground">
                Compact rows show one line with status and glyphs. Settled and snoozed threads are
                always compact.
              </p>
            </div>
            <div>
              <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">Details</p>
              {mergeOrderedItems(DEFAULT_THREAD_ROW_FIELDS, savedFields ?? []).map((id) => {
                const field = THREAD_ROW_FIELDS.find((candidate) => candidate.id === id);
                if (!field) return null;
                const fieldId: ThreadRowFieldId = field.id;
                const enabled = isFieldEnabled(fieldId);
                const textUnavailable = props.value.density === "compact" && field.kind === "text";
                return (
                  <CustomizeListRow
                    key={fieldId}
                    control={
                      <Checkbox
                        checked={enabled}
                        disabled={textUnavailable}
                        onCheckedChange={(checked) => {
                          props.onChange({
                            ...props.value,
                            fields: toggleThreadRowField(
                              props.value.fields,
                              fieldId,
                              checked === true,
                            ),
                          });
                        }}
                      />
                    }
                    description={field.description}
                    label={field.label}
                    {...(textUnavailable ? { unavailableReason: "Shown in hover details in compact rows" } : {})}
                    {...(enabled
                      ? {
                          onMoveDown: () =>
                            props.onChange({
                              ...props.value,
                              fields: moveThreadRowField(props.value.fields, fieldId, "down"),
                            }),
                          onMoveUp: () =>
                            props.onChange({
                              ...props.value,
                              fields: moveThreadRowField(props.value.fields, fieldId, "up"),
                            }),
                        }
                      : {})}
                  />
                );
              })}
            </div>
          </div>
        </CustomizeEditorShell>
      </PopoverPopup>
    </Popover>
  );
}
