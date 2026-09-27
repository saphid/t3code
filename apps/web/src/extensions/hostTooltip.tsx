import type { ClientTooltip, TooltipProps } from "@t3tools/extension-sdk/environment";

import { Tooltip as TooltipRoot, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

function Tooltip({ label, children, side, align }: TooltipProps) {
  if (!label) return children;
  // A disabled control gets no pointer events, so the hover target is a span
  // around it, the way native disabled-reason tooltips are built.
  const disabled = (children.props as { disabled?: unknown }).disabled === true;
  return (
    <TooltipRoot>
      <TooltipTrigger
        render={
          disabled ? (
            <span className="inline-flex shrink-0 *:pointer-events-none">{children}</span>
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
