import { createFileRoute, notFound } from "@tanstack/react-router";

import { ViewProofPage } from "../pluginViewProof/ViewProofPage";

export const Route = createFileRoute("/view-proof")({
  validateSearch: (search: Record<string, unknown>) => ({
    root: typeof search.root === "string" ? search.root : undefined,
    nav: search.nav === "wrapper" ? ("wrapper" as const) : undefined,
    // Read by the iOS proof's patched WebView to turn its native veto off for a baseline run.
    nativeVeto: search.nativeVeto === "off" ? ("off" as const) : undefined,
  }),
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: ViewProofRoute,
});

function ViewProofRoute() {
  const { root, nav } = Route.useSearch();
  return <ViewProofPage root={root ?? null} navigationPolicy={nav ?? "none"} />;
}
