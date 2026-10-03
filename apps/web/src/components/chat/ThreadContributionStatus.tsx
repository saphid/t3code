import type { ContributionStatusTone, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { memo, useMemo } from "react";

import { useThreadContributionStatus } from "../../state/contributionStatus";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type ContributionStatusChip,
  contributionStatusChips,
} from "./ThreadContributionStatus.logic";

const TONE_VARIANT = {
  neutral: "outline",
  info: "info",
  success: "success",
  warning: "warning",
  error: "error",
} as const satisfies Record<ContributionStatusTone, string>;

function ContributionStatusBadge({ chip }: { readonly chip: ContributionStatusChip }) {
  const detail = chip.tooltip ?? chip.text;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={TONE_VARIANT[chip.tone]}
            size="sm"
            className="min-w-0 max-w-48"
            render={<button type="button" aria-label={`${detail}. ${chip.origin}`} />}
          />
        }
      >
        <span className="truncate">{chip.text}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <span className="block">{detail}</span>
        <span className="block text-muted-foreground">{chip.origin}</span>
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * Advisory statuses a provider (today, Pi extensions) set on the open thread.
 * Renders nothing when there are none or the server predates the channel.
 */
export const ThreadContributionStatus = memo(function ThreadContributionStatus(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const entries = useThreadContributionStatus(props.environmentId, props.threadId);
  const chips = useMemo(() => contributionStatusChips(entries), [entries]);
  if (chips.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Provider status"
      data-thread-contribution-status
      className="flex min-w-0 max-w-[45%] shrink items-center gap-1 overflow-hidden"
    >
      {chips.map((chip) => (
        <ContributionStatusBadge key={chip.id} chip={chip} />
      ))}
    </div>
  );
});
