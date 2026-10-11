import { EnvironmentId, ThreadId, type PreviewAnnotationPayload } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ComposerFileAttachment, ComposerImageAttachment } from "../../composerDraftStore";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  buildMessageContext,
  fileContextReference,
  previewAnnotationContextId,
} from "../../lib/composerContextRecords";
import {
  reconcileAttachmentContextReferences,
  clearRetainedAttachmentContextPayloads,
  forgetLiveAttachmentContextPayloads,
  pruneRetainedAttachmentContextPayloads,
  recreateRetainedImagePreview,
  removeRejectedAttachmentContextReferences,
  type RetainedAttachmentContextPayloads,
} from "./composerContextUndo";

const binary = new File(["binary"], "context.png", { type: "image/png" });
const file = {
  type: "file",
  id: "file-1",
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 5,
  file: new File(["notes"], "notes.txt", { type: "text/plain" }),
} satisfies ComposerFileAttachment;
const image = {
  type: "image",
  id: "annotation-1",
  name: "annotation.png",
  mimeType: "image/png",
  sizeBytes: binary.size,
  previewUrl: "blob:annotation",
  file: binary,
} satisfies ComposerImageAttachment;
const annotation = {
  id: "annotation-1",
  pageUrl: "https://example.com",
  pageTitle: "Example",
  comment: "Fix this",
  elements: [],
  regions: [],
  strokes: [],
  styleChanges: [],
  screenshot: {
    dataUrl: "data:image/png;base64,YmluYXJ5",
    width: 1,
    height: 1,
    cropRect: { x: 0, y: 0, width: 1, height: 1 },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
} satisfies PreviewAnnotationPayload;

function retention(): RetainedAttachmentContextPayloads {
  return { files: new Map(), previewAnnotations: new Map() };
}

describe("reconcileAttachmentContextReferences", () => {
  it("removes rejected restore chips before saving the draft for a thread switch", () => {
    const target = { environmentId: EnvironmentId.make("undo-env"), threadId: ThreadId.make("A") };
    const store = useComposerDraftStore.getState();
    store.addFiles(
      target,
      Array.from({ length: 100 }, (_, index) => ({
        ...file,
        id: index === 0 ? file.id : `filler-${index}`,
        name: index === 0 ? file.name : `filler-${index}.txt`,
      })),
      { allowDuplicates: true },
    );
    store.removeFile(target, file.id);
    const fillerImage = { ...image, id: "filler-image", previewUrl: URL.createObjectURL(binary) };
    store.addImages(target, [fillerImage]);
    expect(store.addFiles(target, [file])).toEqual([]);
    const prompt = "Keep this paragraph [notes.txt](t3-context://v1/file/file_file-1)";
    const rejected = removeRejectedAttachmentContextReferences({
      prompt,
      filesToRestore: [file],
      annotationsToRestore: [],
      files: store.getComposerDraft(target)?.files ?? [],
      previewAnnotations: [],
    });
    expect(rejected.rejectedCount).toBe(1);
    expect(rejected.prompt).toBe("Keep this paragraph");
    store.setPrompt(target, rejected.prompt);
    const retained = retention();
    retained.files.set(fileContextReference(file).contextId, file);
    clearRetainedAttachmentContextPayloads(retained);
    store.setPrompt({ ...target, threadId: ThreadId.make("B") }, "Other thread");
    expect(store.getComposerDraft(target)?.prompt).toBe("Keep this paragraph");
    store.removeImage(target, fillerImage.id);
    useComposerDraftStore.setState({ draftsByThreadKey: {} });
    expect(
      removeRejectedAttachmentContextReferences({
        prompt,
        filesToRestore: [file],
        annotationsToRestore: [],
        files: [file],
        previewAnnotations: [],
      }),
    ).toEqual({ prompt, rejectedCount: 0, rejectedIds: [] });
  });

  it("recreates a valid screenshot preview after a draft rejection revoked its URL", async () => {
    const target = {
      environmentId: EnvironmentId.make("undo-env"),
      threadId: ThreadId.make("snapshot"),
    };
    const store = useComposerDraftStore.getState();
    store.addFiles(
      target,
      Array.from({ length: 100 }, (_, index) => ({
        ...file,
        id: `filler-${index}`,
        name: `filler-${index}.txt`,
      })),
      { allowDuplicates: true },
    );
    const previewUrl = URL.createObjectURL(binary);
    expect(store.addImages(target, [{ ...image, previewUrl }])).toEqual([]);
    await expect(fetch(previewUrl)).rejects.toThrow();
    store.removeFile(target, "filler-0");
    const restored = recreateRetainedImagePreview({ ...image, previewUrl });
    expect(store.addImages(target, [restored])).toEqual([image.id]);
    expect(restored.file).toBe(binary);
    expect(await (await fetch(restored.previewUrl)).text()).toBe("binary");
    store.removeImage(target, image.id);
    useComposerDraftStore.setState({ draftsByThreadKey: {} });
  });

  it("restores file bytes after deleting and undoing its chip", () => {
    const retained = retention();
    const removed = reconcileAttachmentContextReferences({
      referencedContextIds: new Set(),
      files: [file],
      images: [],
      previewAnnotations: [],
      retained,
    });
    expect(removed.filesToRemove).toEqual(["file-1"]);

    const restored = reconcileAttachmentContextReferences({
      referencedContextIds: new Set([fileContextReference(file).contextId]),
      files: [],
      images: [],
      previewAnnotations: [],
      retained,
    });
    expect(restored.filesToRestore).toEqual([file]);
    expect(restored.filesToRestore[0]?.file).toBe(file.file);
    forgetLiveAttachmentContextPayloads(retained, restored.filesToRestore, []);
    expect(retained.files.size).toBe(0);
    const redone = reconcileAttachmentContextReferences({
      referencedContextIds: new Set(),
      files: restored.filesToRestore,
      images: [],
      previewAnnotations: [],
      retained,
    });
    expect(redone.filesToRemove).toEqual([file.id]);
    expect(retained.files.get(fileContextReference(file).contextId)?.file).toBe(file.file);
    expect(
      buildMessageContext({
        terminalContexts: [],
        reviewComments: [],
        previewAnnotations: [],
        attachments: [{ attachment: restored.filesToRestore[0]!, attachmentId: "uploaded-file" }],
      })?.records,
    ).toEqual([
      expect.objectContaining({
        kind: "file",
        contextId: "file_file-1",
        attachmentId: "uploaded-file",
      }),
    ]);
  });

  it("restores an annotation and its screenshot attachment after undo", () => {
    const retained = retention();
    const removed = reconcileAttachmentContextReferences({
      referencedContextIds: new Set(),
      files: [],
      images: [image],
      previewAnnotations: [annotation],
      retained,
    });
    expect(removed.annotationIdsToRemove).toEqual(["annotation-1"]);

    const restored = reconcileAttachmentContextReferences({
      referencedContextIds: new Set([previewAnnotationContextId(annotation.id)]),
      files: [],
      images: [],
      previewAnnotations: [],
      retained,
    });
    expect(restored.annotationsToRestore).toEqual([{ annotation, image }]);
    expect(restored.annotationsToRestore[0]?.annotation.screenshot?.dataUrl).toBe(
      "data:image/png;base64,YmluYXJ5",
    );
    expect(restored.annotationsToRestore[0]?.image?.file).toBe(binary);
    forgetLiveAttachmentContextPayloads(retained, [], [annotation]);
    expect(retained.previewAnnotations.size).toBe(0);
    expect(
      buildMessageContext({
        terminalContexts: [],
        reviewComments: [],
        previewAnnotations: restored.annotationsToRestore.map((entry) => entry.annotation),
        attachments: [
          {
            attachment: restored.annotationsToRestore[0]!.image!,
            attachmentId: "uploaded-screenshot",
          },
        ],
      })?.records,
    ).toEqual([
      expect.objectContaining({
        kind: "preview-annotation",
        screenshotContextId: "image_annotation-1",
      }),
      expect.objectContaining({
        kind: "image",
        contextId: "image_annotation-1",
        attachmentId: "uploaded-screenshot",
      }),
    ]);
  });

  it("releases deleted files and snapshots when their editor history is discarded", () => {
    const retained = retention();
    reconcileAttachmentContextReferences({
      referencedContextIds: new Set(),
      files: [file],
      images: [image],
      previewAnnotations: [annotation],
      retained,
    });
    expect(clearRetainedAttachmentContextPayloads(retained)).toEqual([file, image]);
    expect(retained.files.size).toBe(0);
    expect(retained.previewAnnotations.size).toBe(0);
    expect(clearRetainedAttachmentContextPayloads(retained)).toEqual([]);
  });

  it("keeps a supported 50 MiB file undoable", () => {
    const retained = retention();
    const payload = new File([new Uint8Array(50 * 1024 * 1024)], "large.txt");
    const large = { ...file, file: payload, sizeBytes: payload.size };
    const removed = reconcileAttachmentContextReferences({
      referencedContextIds: new Set(),
      files: [large],
      images: [],
      previewAnnotations: [],
      retained,
    });
    const restored = reconcileAttachmentContextReferences({
      referencedContextIds: new Set([fileContextReference(large).contextId]),
      files: [],
      images: [],
      previewAnnotations: [],
      retained,
    });
    expect(restored.filesToRestore[0]?.file).toBe(payload);
  });

  it("retains a rejected restore until the draft accepts it", () => {
    const retained = retention();
    reconcileAttachmentContextReferences({
      referencedContextIds: new Set(),
      files: [file],
      images: [],
      previewAnnotations: [],
      retained,
    });
    const input = {
      referencedContextIds: new Set([fileContextReference(file).contextId]),
      files: [],
      images: [],
      previewAnnotations: [],
      retained,
    };
    expect(reconcileAttachmentContextReferences(input).filesToRestore).toEqual([file]);
    forgetLiveAttachmentContextPayloads(retained, [], []);
    expect(reconcileAttachmentContextReferences(input).filesToRestore).toEqual([file]);
    forgetLiveAttachmentContextPayloads(retained, [file], []);
    expect(retained.files.size).toBe(0);
  });

  it("releases payloads only after their undo and redo references expire", () => {
    const retained = retention();
    const id = fileContextReference(file).contextId;
    reconcileAttachmentContextReferences({
      referencedContextIds: new Set(),
      files: [file],
      images: [],
      previewAnnotations: [],
      retained,
      undoableContextIds: new Set([id]),
    });
    expect(retained.files.get(id)?.file).toBe(file.file);
    const result = reconcileAttachmentContextReferences({
      referencedContextIds: new Set(),
      files: [],
      images: [],
      previewAnnotations: [],
      retained,
      undoableContextIds: new Set(),
    });
    expect(result.releasedAttachments).toEqual([file]);
    expect(retained.files.size).toBe(0);
  });
});
