import type { SVGProps } from "react";

import { cn } from "~/lib/utils";

const PROJECT_MARK_VARIANTS = ["shelves", "drawers", "pegboard", "steps"] as const;

export type ProjectFallbackMarkDescriptor = {
  readonly variant: (typeof PROJECT_MARK_VARIANTS)[number];
};

export function describeProjectFallbackMark(
  environmentId: string,
  cwd: string,
): ProjectFallbackMarkDescriptor | null {
  const normalizedCwd = cwd.trim();
  if (!normalizedCwd) return null;

  let hash = 0x811c9dc5;
  const identity = `${environmentId}\u0000${normalizedCwd}`;
  for (let index = 0; index < identity.length; index++) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return { variant: PROJECT_MARK_VARIANTS[(hash >>> 0) % PROJECT_MARK_VARIANTS.length]! };
}

export function ProjectFallbackMark({
  descriptor,
  className,
  ...svgProps
}: {
  readonly descriptor: ProjectFallbackMarkDescriptor;
} & SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...svgProps}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("size-3.5 shrink-0 text-icon-muted", className)}
    >
      <path
        d="M1.75 4.5c0-.69.56-1.25 1.25-1.25h3l1.25 1.5H13c.69 0 1.25.56 1.25 1.25v6.25c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25V4.5Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <ProjectMarkGeometry variant={descriptor.variant} />
    </svg>
  );
}

function ProjectMarkGeometry({ variant }: ProjectFallbackMarkDescriptor) {
  switch (variant) {
    case "shelves":
      return (
        <path
          d="M4.25 7h7.5v1.25h-7.5V7Zm0 2.5h3.25v1.25H4.25V9.5Zm4.5 0h3v1.25h-3V9.5Z"
          fill="currentColor"
        />
      );
    case "drawers":
      return (
        <path
          d="M4.25 7h3v3.75h-3V7Zm4.25 0h3.25v1.25H8.5V7Zm0 2.5h3.25v1.25H8.5V9.5Z"
          fill="currentColor"
        />
      );
    case "pegboard":
      return (
        <path
          d="M4.25 7h1.5v1.5h-1.5V7Zm3 0h1.5v1.5h-1.5V7Zm3 0h1.5v1.5h-1.5V7Zm-6 3h1.5v1.5h-1.5V10Zm3 0h4.5v1.5h-4.5V10Z"
          fill="currentColor"
        />
      );
    case "steps":
      return (
        <path
          d="M4.25 9.75h2v1.5h-2v-1.5Zm2.75-1.5h2v3H7v-3Zm2.75-1.5h2v4.5h-2v-4.5Z"
          fill="currentColor"
        />
      );
  }
}
