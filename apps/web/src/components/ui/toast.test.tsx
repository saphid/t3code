// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { compile } from "tailwindcss";
import { ToastProvider, toastManager } from "./toast";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useParams: () => undefined,
}));
vi.mock("~/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: vi.fn(), isCopied: false }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
const toastIds: ReturnType<typeof toastManager.add>[] = [];
afterEach(async () => {
  await act(async () => {
    for (const id of toastIds.splice(0)) toastManager.close(id);
    root.render(null);
  });
});

it("keeps an unswiped right-side toast inside a 1600px viewport while entering and leaving", async () => {
  await act(async () => {
    root.render(<ToastProvider />);
  });
  await act(async () => {
    toastIds.push(toastManager.add({ type: "error", title: "Checkout failed" }));
  });
  const toast = document.querySelector<HTMLElement>(
    "[data-slot=toast-viewport] > [data-position]",
  )!;
  expect(toast).not.toBeNull();
  const compiler = await compile("@tailwind utilities;");
  const stylesheet = document.createElement("style");
  stylesheet.textContent = compiler.build([...toast.classList]);
  document.head.append(stylesheet);
  try {
    for (const transition of ["starting", "ending"]) {
      toast.removeAttribute("data-starting-style");
      toast.removeAttribute("data-ending-style");
      toast.setAttribute(`data-${transition}-style`, "");
      const transform = getComputedStyle(toast).transform;
      // Resolve Tailwind's off-screen translate against the real desktop card dimensions.
      // jsdom does not lay out pixels; this checks the compiled transform, not compositor timing.
      const width = 360;
      const inset = 32;
      const offsetX = transform.startsWith("translateX(calc(100% + var(--toast-inset)))")
        ? width + inset
        : transform.startsWith("translateY(") ||
            transform.startsWith("translateX(var(--toast-swipe-movement-x))")
          ? 0
          : Number.NaN;
      const right = 1600 - inset + offsetX;
      expect(right, `${transition}: ${transform}`).toBeLessThanOrEqual(1600);
    }
  } finally {
    stylesheet.remove();
  }
});

it("lets a user reveal the complete login command in a long checkout error", async () => {
  const detail =
    "If private, run `glab auth login --hostname gitlab.127.0.0.1.nip.io --api-host gitlab.127.0.0.1.nip.io:18880` and retry. Merge request !1 was not found or is inaccessible on gitlab.127.0.0.1.nip.io:18880.";
  await act(async () => {
    root.render(<ToastProvider />);
  });
  await act(async () => {
    toastIds.push(
      toastManager.add({
        type: "error",
        title: "Could not prepare the pull request checkout",
        description: detail,
      }),
    );
  });
  const disclosure = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Show details"),
  );
  expect(disclosure).toBeDefined();
  await act(async () => {
    disclosure!.click();
  });
  expect(disclosure!.getAttribute("aria-expanded")).toBe("true");
  expect(disclosure!.parentElement?.textContent).toContain(detail);
  await act(async () => {
    disclosure!.click();
  });
  expect(disclosure!.getAttribute("aria-expanded")).toBe("false");
  expect(disclosure!.parentElement?.textContent).not.toContain(detail);
});
