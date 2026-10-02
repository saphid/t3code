import { validateContext, type ViewContext } from "@t3tools/extension-sdk/contracts";
import { MOBILE_UI_CAPABILITIES } from "./mobileUiProviders";
import type { MobilePageBootstrap } from "./mobileHostPage";

export function isMobileApiSupported(id: string, operation?: string) {
  if (!id.startsWith("t3.ui/")) return true;
  const support = MOBILE_UI_CAPABILITIES[id];
  if (!support || !Object.values(support.operations).some(Boolean)) return false;
  return (
    operation === undefined ||
    operation === "getCapabilities" ||
    support.operations[operation] === true
  );
}

export function buildMobileHostHtml(pageSource: string, bootstrap: MobilePageBootstrap) {
  const data = JSON.stringify(bootstrap).replace(/</g, "\\u003c");
  const script = pageSource.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; worker-src blob:; connect-src 'none'"><style>html,body,#root{height:100%;margin:0;background:var(--background,#17191d);color:var(--foreground,#f4f4f5);font:14px -apple-system,BlinkMacSystemFont,sans-serif}*{box-sizing:border-box}body{overflow:hidden}#root{overflow:auto;padding:var(--t3-safe-area-top) var(--t3-safe-area-right) calc(var(--t3-safe-area-bottom) + var(--t3-keyboard-inset,0px)) var(--t3-safe-area-left)}button,input,select,textarea{font:inherit}button{color:inherit}</style></head><body><div id="root"></div><script>window.__t3MobileBootstrap=${data};</script><script>${script}</script></body></html>`;
}

export function boundMobileRequest<
  Request extends { context: ViewContext; clientConnectionId?: string },
>(request: Request, context: ViewContext): Request {
  validateContext(request.context);
  if (JSON.stringify(request.context) !== JSON.stringify(context))
    throw new Error("MobileContextDenied");
  const { clientConnectionId: _untrustedIdentity, ...rest } = request;
  return { ...rest, context } as Request;
}
