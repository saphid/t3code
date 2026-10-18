import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { HostedPairingHeading } from "./PairingRouteSurface";

describe("HostedPairingHeading", () => {
  it("shows the settled clasp on an existing successful snapshot", () => {
    const markup = renderToStaticMarkup(<HostedPairingHeading status="paired" />);

    expect(markup).toContain("Backend paired");
    expect(markup).toContain("data-connection-clasp");
    expect(markup).toContain('data-motion="settled"');
  });

  it("keeps fresh success hydration static before the client effect", () => {
    const markup = renderToStaticMarkup(
      <HostedPairingHeading status="paired" playConnectionClasp />,
    );

    expect(markup).toContain("data-connection-clasp");
    expect(markup).toContain('data-motion="settled"');
  });

  it.each([
    ["pairing", "Pairing backend"],
    ["error", "Pairing failed"],
  ] as const)("does not show the clasp for the %s state", (status, label) => {
    const markup = renderToStaticMarkup(<HostedPairingHeading status={status} />);

    expect(markup).toContain(label);
    expect(markup).not.toContain("data-connection-clasp");
  });
});
