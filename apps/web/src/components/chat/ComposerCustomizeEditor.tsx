import type { ComposerControlsPreference } from "@t3tools/contracts";
import type { RefObject } from "react";

import { CustomizeEditorShell } from "../../personalization/CustomizeEditorShell";
import { CustomizeListRow } from "../../personalization/CustomizeListRow";
import { Popover, PopoverPopup } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  COMPOSER_CONTROL_BLOCKS,
  isRecommendedComposerControls,
  moveComposerControl,
  resolveComposerControls,
  setComposerControlPlacement,
} from "./composerControlsPreference";

const PLACEMENT_ITEMS = [
  { value: "pinned", label: "Pinned" },
  { value: "more", label: "In More" },
  { value: "hidden", label: "Hidden" },
] as const satisfies ReadonlyArray<{ value: "pinned" | "more" | "hidden"; label: string }>;

/**
 * The composer's customize editor. Controlled by `ChatComposer`: it owns the
 * draft, persistence on Done, and discarding on Cancel, Escape and outside
 * click (the Popover's `onOpenChange`); this component only renders.
 */
export function ComposerCustomizeEditor(props: {
  readonly anchor: RefObject<HTMLElement | null>;
  readonly open: boolean;
  readonly value: ComposerControlsPreference;
  readonly availableIds: ReadonlySet<string>;
  readonly onChange: (value: ComposerControlsPreference) => void;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly onReset: () => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const resolved = resolveComposerControls(props.value, props.availableIds);
  return (
    <Popover onOpenChange={props.onOpenChange} open={props.open}>
      <PopoverPopup align="start" anchor={props.anchor} className="w-80" side="top" sideOffset={8}>
        <CustomizeEditorShell
          description="Choose which controls stay in the strip. Width still moves the last pinned controls into More."
          onDone={props.onDone}
          onCancel={props.onCancel}
          onReset={props.onReset}
          resetDisabled={isRecommendedComposerControls(props.value)}
          title="Customize composer"
        >
          <div className="flex flex-col">
            <CustomizeListRow description="Always first." fixed label="Model" />
            {resolved.order.map((id, index) => {
              const definition = COMPOSER_CONTROL_BLOCKS.find((block) => block.id === id);
              if (!definition) return null;
              const placement = resolved.placements[id] ?? "pinned";
              const description = definition.canHide
                ? definition.description
                : `${definition.description} Never hidden.`;
              const placementItems = definition.canHide
                ? PLACEMENT_ITEMS
                : PLACEMENT_ITEMS.filter((item) => item.value !== "hidden");
              return (
                <CustomizeListRow
                  key={id}
                  description={description}
                  label={definition.label}
                  {...(index < resolved.order.length - 1
                    ? {
                        onMoveDown: () =>
                          props.onChange(moveComposerControl(props.value, id, "down")),
                      }
                    : {})}
                  {...(index > 0
                    ? {
                        onMoveUp: () => props.onChange(moveComposerControl(props.value, id, "up")),
                      }
                    : {})}
                  {...(props.availableIds.has(id)
                    ? {
                        control: (
                          <ToggleGroup
                            aria-label={`${definition.label} placement`}
                            className="shrink-0"
                            onValueChange={(next) => {
                              const selected = PLACEMENT_ITEMS.find(
                                (item) => item.value === next[0],
                              );
                              if (selected) {
                                props.onChange(
                                  setComposerControlPlacement(props.value, id, selected.value),
                                );
                              }
                            }}
                            value={[placement]}
                            variant="segmented"
                          >
                            {placementItems.map((item) => (
                              <Toggle key={item.value} value={item.value}>
                                {item.label}
                              </Toggle>
                            ))}
                          </ToggleGroup>
                        ),
                      }
                    : { unavailableReason: "Not offered by the current provider" })}
                />
              );
            })}
            <CustomizeListRow description="Always last." fixed label="Send / Stop" />
          </div>
        </CustomizeEditorShell>
      </PopoverPopup>
    </Popover>
  );
}
