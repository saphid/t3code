import type { ClientTooltip, TooltipProps } from "@t3tools/extension-sdk/environment";

import { Tooltip as TooltipRoot, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

function Tooltip({ label, children, side, align, showWhenDisabled = false }: TooltipProps) {
  if (!label) return children;
  const disabled = (children.props as { disabled?: unknown }).disabled === true;
  // Native disabled controls take no pointer events and show no tooltip.
  if (disabled && !showWhenDisabled) return children;
  return (
    <TooltipRoot>
      <TooltipTrigger
        render={
          showWhenDisabled ? (
            // A disabled-reason tooltip needs a hover target that still gets
            // pointer events. It wraps in both states so the control's
            // ancestry does not change as it enables and disables.
            <span className={disabled ? "inline-flex *:pointer-events-none" : "inline-flex"}>
              {children}
            </span>
          ) : (
            children
          )
        }
      />
      <TooltipPopup side={side} align={align}>
        {label}
      </TooltipPopup>
    </TooltipRoot>
  );
}

/** The web and desktop `ClientHost.tooltip`: the native tooltip, shared by every installed client. */
export const hostTooltip: ClientTooltip = { version: 1, Tooltip };
