import type { PreviewAnnotationPayload } from "@t3tools/contracts";

import type { ComposerFileAttachment, ComposerImageAttachment } from "../../composerDraftStore";
import { fileContextReference, previewAnnotationContextId } from "../../lib/composerContextRecords";
import { removeInlineContextReference } from "../../lib/composerContextReferences";

interface RetainedPreviewAnnotation {
  annotation: PreviewAnnotationPayload;
  image: ComposerImageAttachment | undefined;
}

export interface RetainedAttachmentContextPayloads {
  files: Map<string, ComposerFileAttachment>;
  previewAnnotations: Map<string, RetainedPreviewAnnotation>;
}

/** Only deleted payloads live here; restored payloads belong to the draft again. */
export function clearRetainedAttachmentContextPayloads(
  retained: RetainedAttachmentContextPayloads,
) {
  const attachments = [
    ...retained.files.values(),
    ...[...retained.previewAnnotations.values()].flatMap(({ image }) => (image ? [image] : [])),
  ];
  retained.files.clear();
  retained.previewAnnotations.clear();
  return attachments;
}

/** Release payloads whose chips occur in neither the draft nor reachable history. */
export function pruneRetainedAttachmentContextPayloads(
  retained: RetainedAttachmentContextPayloads,
  undoableContextIds: ReadonlySet<string>,
) {
  const released: (ComposerFileAttachment | ComposerImageAttachment)[] = [];
  for (const [id, file] of retained.files) {
    if (undoableContextIds.has(id)) continue;
    retained.files.delete(id);
    released.push(file);
  }
  for (const [id, { image }] of retained.previewAnnotations) {
    if (undoableContextIds.has(id)) continue;
    retained.previewAnnotations.delete(id);
    if (image) released.push(image);
  }
  return released;
}

/** A restore may be rejected by draft limits; forget it only after acceptance. */
export function forgetLiveAttachmentContextPayloads(
  retained: RetainedAttachmentContextPayloads,
  files: ReadonlyArray<ComposerFileAttachment>,
  previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>,
) {
  for (const file of files) retained.files.delete(fileContextReference(file).contextId);
  for (const annotation of previewAnnotations)
    retained.previewAnnotations.delete(previewAnnotationContextId(annotation.id));
}

/** A rejected image add revokes its URL; an undo retry needs a fresh preview. */
export function recreateRetainedImagePreview(image: ComposerImageAttachment) {
  if (!image.file) return image;
  const previewUrl = URL.createObjectURL(image.file);
  if (image.previewUrl.startsWith("blob:")) URL.revokeObjectURL(image.previewUrl);
  return { ...image, previewUrl };
}

/** Never save a restored chip when draft limits or deduplication reject its payload. */
export function removeRejectedAttachmentContextReferences(input: {
  prompt: string;
  filesToRestore: ReadonlyArray<ComposerFileAttachment>;
  annotationsToRestore: ReadonlyArray<RetainedPreviewAnnotation>;
  files: ReadonlyArray<ComposerFileAttachment>;
  previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
}) {
  const liveIds = new Set([
    ...input.files.map((file) => fileContextReference(file).contextId),
    ...input.previewAnnotations.map((annotation) => previewAnnotationContextId(annotation.id)),
  ]);
  const rejectedIds = [
    ...input.filesToRestore.map((file) => fileContextReference(file).contextId),
    ...input.annotationsToRestore.map(({ annotation }) =>
      previewAnnotationContextId(annotation.id),
    ),
  ].filter((id) => !liveIds.has(id));
  let prompt = input.prompt;
  for (const id of rejectedIds) prompt = removeInlineContextReference(prompt, id).prompt;
  return { prompt, rejectedCount: rejectedIds.length, rejectedIds };
}

export function reconcileAttachmentContextReferences(input: {
  referencedContextIds: ReadonlySet<string>;
  files: ReadonlyArray<ComposerFileAttachment>;
  images: ReadonlyArray<ComposerImageAttachment>;
  previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
  retained: RetainedAttachmentContextPayloads;
  undoableContextIds?: ReadonlySet<string> | undefined;
}): {
  filesToRemove: string[];
  filesToRestore: ComposerFileAttachment[];
  annotationIdsToRemove: string[];
  annotationsToRestore: RetainedPreviewAnnotation[];
  releasedAttachments: (ComposerFileAttachment | ComposerImageAttachment)[];
} {
  const liveFileContextIds = new Set<string>(
    input.files.map((file) => fileContextReference(file).contextId),
  );
  const filesToRemove: string[] = [];
  for (const file of input.files) {
    const contextId = fileContextReference(file).contextId;
    if (input.referencedContextIds.has(contextId)) {
      input.retained.files.delete(contextId);
      continue;
    }
    input.retained.files.set(contextId, file);
    filesToRemove.push(file.id);
  }
  const filesToRestore = [...input.referencedContextIds].flatMap((contextId) => {
    if (liveFileContextIds.has(contextId)) return [];
    const file = input.retained.files.get(contextId);
    if (!file) return [];
    return [file];
  });

  const imagesById = new Map(input.images.map((image) => [image.id, image]));
  const liveAnnotationContextIds = new Set<string>(
    input.previewAnnotations.map((annotation) => previewAnnotationContextId(annotation.id)),
  );
  const annotationIdsToRemove: string[] = [];
  for (const annotation of input.previewAnnotations) {
    const contextId = previewAnnotationContextId(annotation.id);
    if (input.referencedContextIds.has(contextId)) {
      input.retained.previewAnnotations.delete(contextId);
      continue;
    }
    input.retained.previewAnnotations.set(contextId, {
      annotation,
      image: imagesById.get(annotation.id),
    });
    annotationIdsToRemove.push(annotation.id);
  }
  const annotationsToRestore = [...input.referencedContextIds].flatMap((contextId) => {
    if (liveAnnotationContextIds.has(contextId)) return [];
    const retained = input.retained.previewAnnotations.get(contextId);
    if (!retained) return [];
    return [retained];
  });

  const expiredAttachments = input.undoableContextIds
    ? pruneRetainedAttachmentContextPayloads(input.retained, input.undoableContextIds)
    : [];
  return {
    filesToRemove,
    filesToRestore,
    annotationIdsToRemove,
    annotationsToRestore,
    releasedAttachments: expiredAttachments,
  };
}
