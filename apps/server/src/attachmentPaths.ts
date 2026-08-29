// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

export function normalizeAttachmentRelativePath(rawRelativePath: string): string | null {
  if (
    rawRelativePath.length === 0 ||
    NodePath.posix.isAbsolute(rawRelativePath) ||
    NodePath.win32.isAbsolute(rawRelativePath) ||
    rawRelativePath.includes("\0")
  ) {
    return null;
  }
  const normalized = NodePath.normalize(rawRelativePath);
  if (normalized.length === 0 || normalized.startsWith("..")) {
    return null;
  }
  return normalized.replace(/\\/g, "/");
}

export function resolveAttachmentRelativePath(input: {
  readonly attachmentsDir: string;
  readonly relativePath: string;
}): string | null {
  const normalizedRelativePath = normalizeAttachmentRelativePath(input.relativePath);
  if (!normalizedRelativePath) {
    return null;
  }

  const attachmentsRoot = NodePath.resolve(input.attachmentsDir);
  const filePath = NodePath.resolve(NodePath.join(attachmentsRoot, normalizedRelativePath));
  if (!filePath.startsWith(`${attachmentsRoot}${NodePath.sep}`)) {
    return null;
  }
  return filePath;
}
