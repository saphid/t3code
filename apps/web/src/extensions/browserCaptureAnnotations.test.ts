import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  readBrowserCaptureAnnotation,
  retainBrowserCaptureAnnotation,
} from "./browserCaptureAnnotations";

const annotation = {
  id: "annotation-a",
  pageUrl: "https://example.com",
  pageTitle: "Example",
  comment: "Move this region",
  elements: [],
  regions: [{ id: "region-a", rect: { x: 1, y: 2, width: 3, height: 4 } }],
  strokes: [],
  styleChanges: [],
  screenshot: null,
  createdAt: "2026-09-30T00:00:00Z",
};

describe("client-local browser annotation references", () => {
  const lifetimes: AbortController[] = [];
  const retain = () => {
    const lifetime = new AbortController();
    lifetimes.push(lifetime);
    const handle = retainBrowserCaptureAnnotation({
      environmentId: "env",
      threadId: "thread",
      installationId: "ext",
      lifetime: lifetime.signal,
      annotation,
      file: null,
      screenshotFailed: false,
    });
    return { ...handle, lifetime };
  };
  const read = (annotationRef: string) =>
    readBrowserCaptureAnnotation("env", "thread", "ext", annotationRef);
  afterEach(() => {
    for (const lifetime of lifetimes.splice(0)) lifetime.abort();
    vi.useRealTimers();
  });

  it("keeps the exact native payload and is scoped to installation, environment and thread", () => {
    const handle = retain();
    expect(read(handle.annotationRef)?.annotation).toEqual(annotation);
    expect(readBrowserCaptureAnnotation("other", "thread", "ext", handle.annotationRef)).toBeNull();
    expect(readBrowserCaptureAnnotation("env", "other", "ext", handle.annotationRef)).toBeNull();
    expect(readBrowserCaptureAnnotation("env", "thread", "other", handle.annotationRef)).toBeNull();
    handle.setArtifact("pending-a");
    expect(read(handle.annotationRef)?.artifactRef).toBe("pending-a");
    read(handle.annotationRef)?.consume();
    expect(read(handle.annotationRef)).toBeNull();
  });

  it("invalidates references when their installed client retires", () => {
    const handle = retain();
    handle.lifetime.abort();
    expect(read(handle.annotationRef)).toBeNull();
    handle.setArtifact("pending-a");
    expect(read(handle.annotationRef)).toBeNull();
  });

  it("expires abandoned references without a background timer and bounds retention", () => {
    vi.useFakeTimers();
    const expired = retain();
    vi.advanceTimersByTime(5 * 60_000);
    expect(read(expired.annotationRef)).toBeNull();
    const oldest = retain();
    for (let index = 0; index < 32; index += 1) retain();
    expect(read(oldest.annotationRef)).toBeNull();
  });
});
