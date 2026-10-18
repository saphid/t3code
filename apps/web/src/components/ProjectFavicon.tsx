import type { EnvironmentId } from "@t3tools/contracts";
import {
  getProjectFaviconCacheKey,
  isProjectFaviconFallbackUrl,
} from "@t3tools/shared/projectFavicon";
import { FolderIcon } from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import { useAssetUrlState } from "../assets/assetUrls";
import { describeProjectFallbackMark, ProjectFallbackMark } from "./ProjectFallbackMark";
import { cn } from "~/lib/utils";

const loadedProjectFaviconSrcs = new Map<string, string>();

export function ProjectFavicon(input: {
  environmentId: EnvironmentId;
  cwd: string;
  faviconPath?: string | null | undefined;
  className?: string | undefined;
  fallbackIcon?: ComponentType<{ className?: string }>;
}) {
  const state = useProjectFaviconAsset(input);
  const src = state._tag === "Success" ? state.url : null;
  if (!src || isProjectFaviconFallbackUrl(src)) {
    return (
      <ProjectFaviconFallback
        environmentId={input.environmentId}
        cwd={input.cwd}
        className={input.className}
        icon={input.fallbackIcon}
      />
    );
  }

  const cacheKey = getProjectFaviconCacheKey(input.environmentId, input.cwd, src);

  return (
    <ProjectFaviconImage
      key={cacheKey}
      cacheKey={cacheKey}
      src={src}
      className={input.className}
      environmentId={input.environmentId}
      cwd={input.cwd}
      fallbackIcon={input.fallbackIcon}
    />
  );
}

export function useProjectFaviconAsset(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly faviconPath?: string | null | undefined;
}) {
  return useAssetUrlState(input.environmentId, {
    _tag: "project-favicon",
    cwd: input.cwd,
    ...(input.faviconPath ? { path: input.faviconPath } : {}),
  });
}

function ProjectFaviconFallback({
  environmentId,
  cwd,
  className,
  icon: Icon,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly className?: string | undefined;
  readonly icon?: ComponentType<{ className?: string }> | undefined;
}) {
  if (Icon) {
    return <Icon className={cn("size-3.5 shrink-0 text-icon-muted", className)} />;
  }

  const descriptor = describeProjectFallbackMark(environmentId, cwd);
  if (descriptor) {
    return <ProjectFallbackMark descriptor={descriptor} className={className} />;
  }

  return <FolderIcon className={cn("size-3.5 shrink-0 text-icon-muted", className)} />;
}

function ProjectFaviconImage({
  cacheKey,
  src,
  className,
  environmentId,
  cwd,
  fallbackIcon: FallbackIcon,
}: {
  readonly cacheKey: string;
  readonly src: string;
  readonly className?: string | undefined;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly fallbackIcon?: ComponentType<{ className?: string }> | undefined;
}) {
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(
    () => loadedProjectFaviconSrcs.get(cacheKey) ?? null,
  );
  const isLoading = displayedSrc !== src;
  const handleLoadError = (failedSrc: string) => {
    if (loadedProjectFaviconSrcs.get(cacheKey) === failedSrc) {
      loadedProjectFaviconSrcs.delete(cacheKey);
    }
    setDisplayedSrc((currentSrc) => (currentSrc === failedSrc ? null : currentSrc));
  };

  return (
    <>
      {displayedSrc === null ? (
        <ProjectFaviconFallback
          environmentId={environmentId}
          cwd={cwd}
          className={className}
          icon={FallbackIcon}
        />
      ) : null}
      {displayedSrc ? (
        <img
          src={displayedSrc}
          alt=""
          className={cn("size-3.5 shrink-0 rounded-sm object-contain", className)}
          onError={() => handleLoadError(displayedSrc)}
        />
      ) : null}
      {isLoading ? (
        <img
          src={src}
          alt=""
          className="hidden"
          onLoad={() => {
            loadedProjectFaviconSrcs.set(cacheKey, src);
            setDisplayedSrc(src);
          }}
          onError={() => handleLoadError(src)}
        />
      ) : null}
    </>
  );
}
