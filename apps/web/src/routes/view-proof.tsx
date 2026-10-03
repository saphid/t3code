import { createFileRoute, notFound } from "@tanstack/react-router";

import { ViewProofPage } from "../pluginViewProof/ViewProofPage";

export const Route = createFileRoute("/view-proof")({
  validateSearch: (search: Record<string, unknown>) => ({
    root: typeof search.root === "string" ? search.root : undefined,
  }),
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: ViewProofRoute,
});

function ViewProofRoute() {
  const { root } = Route.useSearch();
  return <ViewProofPage root={root ?? null} />;
}
