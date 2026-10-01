import { describe, expect, it } from "vite-plus/test";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import {
  boundMobileRequest,
  buildMobileHostHtml,
  isMobileApiSupported,
} from "./mobileHostProtocol";

const context: ViewContext = {
  resource: {
    namespace: "t3.thread",
    id: "thread",
    threadId: "thread",
    environmentId: "environment",
    projectId: "project",
  },
  client: "mobile",
  workspaceRevision: "revision",
};

describe("mobile host authority and page boundary", () => {
  it("binds context and strips a borrowed provider identity", () => {
    const request = { context, clientConnectionId: "borrowed", id: "t3.orchestration/status" };
    expect(boundMobileRequest(request, context)).toEqual({ context, id: request.id });
    expect(() =>
      boundMobileRequest(
        { ...request, context: { ...context, workspaceRevision: "changed" } },
        context,
      ),
    ).toThrow("MobileContextDenied");
  });
  it("exposes only bridged mobile UI APIs", () => {
    expect(isMobileApiSupported("t3.ui/theme")).toBe(false);
    expect(isMobileApiSupported("t3.orchestration/status")).toBe(true);
    expect(isMobileApiSupported("t3.ui/navigation")).toBe(false);
    expect(isMobileApiSupported("t3.ui/terminal")).toBe(false);
  });
  it("keeps bootstrap data in its script and denies page network access", () => {
    const html = buildMobileHostHtml("globalThis.example=1;", {
      generation: "one",
      code: "</script><script>bad()</script>",
      context,
      surfaceId: "t3.agents/view",
      environmentLabel: "fixture",
      cssVars: {},
      insets: { top: 0, right: 0, bottom: 20, left: 0 },
      keyboardInset: 0,
    });
    expect(html).not.toContain("<script>bad()");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("viewport-fit=cover");
  });
});
