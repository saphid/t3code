import type { EnvironmentId } from "@t3tools/contracts";
import {
  getProjectFaviconCacheKey,
  isProjectFaviconFallbackUrl,
} from "@t3tools/shared/projectFavicon";
import { FolderIcon } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { useAssetUrlState } from "../assets/assetUrls";
import { cn } from "~/lib/utils";

const loadedProjectFaviconSrcs = new Map<string, string>();
const projectFaviconColors = new Map<string, string | null>();

export function ProjectFavicon(input: {
  environmentId: EnvironmentId;
  cwd: string;
  faviconPath?: string | null | undefined;
  className?: string | undefined;
  fallbackIcon?: ComponentType<{ className?: string }>;
}) {
  const state = useProjectFaviconAsset(input);
  const src = state._tag === "Success" ? state.url : null;
  const FallbackIcon = input.fallbackIcon ?? FolderIcon;

  if (!src || isProjectFaviconFallbackUrl(src)) {
    return <ProjectFaviconFallback className={input.className} icon={FallbackIcon} />;
  }

  const cacheKey = getProjectFaviconCacheKey(input.environmentId, input.cwd, src);

  return (
    <ProjectFaviconImage
      key={cacheKey}
      cacheKey={cacheKey}
      src={src}
      className={input.className}
      fallbackIcon={FallbackIcon}
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

/** Returns a subtle RGB accent derived from a loaded project icon. */
export function useProjectFaviconColor(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly faviconPath?: string | null | undefined;
}) {
  const state = useProjectFaviconAsset(input);
  const src =
    state._tag === "Success" && !isProjectFaviconFallbackUrl(state.url) ? state.url : null;
  const cacheKey =
    src === null ? null : getProjectFaviconCacheKey(input.environmentId, input.cwd, src);
  const [color, setColor] = useState<string | null>(() =>
    cacheKey === null ? null : (projectFaviconColors.get(cacheKey) ?? null),
  );

  useEffect(() => {
    if (cacheKey === null || src === null) {
      setColor(null);
      return;
    }
    const cached = projectFaviconColors.get(cacheKey);
    if (cached !== undefined) {
      setColor(cached);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      let sampled: string | null = null;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          sampled = extractProjectFaviconColor(
            context.getImageData(0, 0, canvas.width, canvas.height).data,
          );
        }
      } catch {
        // Some browser/security combinations do not allow sampling an image.
      }
      projectFaviconColors.set(cacheKey, sampled);
      if (!cancelled) setColor(sampled);
    };
    image.onerror = () => {
      projectFaviconColors.set(cacheKey, null);
      if (!cancelled) setColor(null);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [cacheKey, src]);

  return color;
}

export function extractProjectFaviconColor(data: Uint8ClampedArray): string | null {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let index = 0; index < data.length; index += 4) {
    const pixelRed = data[index];
    const pixelGreen = data[index + 1];
    const pixelBlue = data[index + 2];
    const pixelAlpha = data[index + 3];
    if (
      pixelRed === undefined ||
      pixelGreen === undefined ||
      pixelBlue === undefined ||
      pixelAlpha === undefined
    ) {
      continue;
    }
    const alpha = pixelAlpha / 255;
    if (alpha < 0.2) continue;
    const maximum = Math.max(pixelRed, pixelGreen, pixelBlue);
    const minimum = Math.min(pixelRed, pixelGreen, pixelBlue);
    const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
    const pixelWeight = alpha * (0.25 + saturation);
    red += pixelRed * pixelWeight;
    green += pixelGreen * pixelWeight;
    blue += pixelBlue * pixelWeight;
    weight += pixelWeight;
  }
  if (weight === 0) return null;
  return `rgb(${Math.round(red / weight)} ${Math.round(green / weight)} ${Math.round(blue / weight)})`;
}

function ProjectFaviconFallback({
  className,
  icon: Icon,
}: {
  readonly className?: string | undefined;
  readonly icon: ComponentType<{ className?: string }>;
}) {
  return <Icon className={cn("size-3.5 shrink-0 text-icon-muted", className)} />;
}

function ProjectFaviconImage({
  cacheKey,
  src,
  className,
  fallbackIcon: FallbackIcon,
}: {
  readonly cacheKey: string;
  readonly src: string;
  readonly className?: string | undefined;
  readonly fallbackIcon: ComponentType<{ className?: string }>;
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
        <ProjectFaviconFallback className={className} icon={FallbackIcon} />
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
