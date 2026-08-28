import { createFileRoute } from "@tanstack/react-router";

import { StatsForNerdsPanel } from "../components/settings/StatsForNerds";

export const Route = createFileRoute("/settings/stats")({
  component: StatsForNerdsPanel,
});
