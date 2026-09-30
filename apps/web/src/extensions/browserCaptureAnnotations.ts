import type { PreviewAnnotationPayload } from "@t3tools/contracts";
import { randomUUID } from "../lib/utils";

export interface BrowserCaptureAnnotation {
  readonly annotation: PreviewAnnotationPayload;
  readonly file: File | null;
  readonly artifactRef: string | null;
  readonly screenshotFailed: boolean;
  readonly consume: () => void;
}

interface RetainedAnnotation extends BrowserCaptureAnnotation {
  readonly environmentId: string;
  readonly threadId: string;
  readonly installationId: string;
  readonly expiresAt: number;
}

const retained = new Map<string, RetainedAnnotation>();

export function retainBrowserCaptureAnnotation(input: {
  readonly environmentId: string;
  readonly threadId: string;
  readonly installationId: string;
  readonly lifetime: AbortSignal;
  readonly annotation: PreviewAnnotationPayload;
  readonly file: File | null;
  readonly screenshotFailed: boolean;
}) {
  const annotationRef = `preview-annotation-${randomUUID()}`;
  const consume = () => {
    retained.delete(annotationRef);
    input.lifetime.removeEventListener("abort", consume);
  };
  const entry = {
    environmentId: input.environmentId,
    threadId: input.threadId,
    installationId: input.installationId,
    annotation: input.annotation,
    file: input.file,
    screenshotFailed: input.screenshotFailed,
    artifactRef: null,
    expiresAt: Date.now() + 5 * 60_000,
    consume,
  } satisfies RetainedAnnotation;
  for (const previous of retained.values()) {
    if (previous.expiresAt <= Date.now()) previous.consume();
  }
  retained.set(annotationRef, entry);
  while (retained.size > 32) retained.values().next().value?.consume();
  input.lifetime.addEventListener("abort", consume, { once: true });
  if (input.lifetime.aborted) consume();
  return {
    annotationRef,
    setArtifact(artifactRef: string) {
      const current = retained.get(annotationRef);
      if (current) retained.set(annotationRef, { ...current, artifactRef });
    },
  };
}

export function readBrowserCaptureAnnotation(
  environmentId: string,
  threadId: string,
  installationId: string,
  annotationRef: string,
): BrowserCaptureAnnotation | null {
  const entry = retained.get(annotationRef);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entry.consume();
    return null;
  }
  return entry.environmentId === environmentId &&
    entry.threadId === threadId &&
    entry.installationId === installationId
    ? entry
    : null;
}
