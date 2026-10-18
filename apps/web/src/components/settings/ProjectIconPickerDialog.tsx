import * as Schema from "effect/Schema";
import { deriveProjectIdentity } from "../../projectIdentity";
import { ProjectMonogram } from "../ProjectMonogram";
import {
  isProviderAvailable,
  ProjectMonogramText,
  type ProjectIconColor,
  type ProjectIconOverride,
  type ServerProvider,
} from "@t3tools/contracts";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterProjectIconNames,
  firstEmoji,
  PROJECT_EMOJIS,
  PROJECT_ICON_COLORS,
  projectIconColorClassName,
} from "../../projectIconOptions";
import { serverEnvironment } from "~/state/server";
import { projectFaviconUrlAtom } from "~/state/assets";
import { useAtomValue } from "@effect/atom-react";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { ChevronDownIcon, SparklesIcon } from "lucide-react";

const DEFAULT_ICON: IconName = "folder-code";
const isMonogramText = Schema.is(ProjectMonogramText);

function iconLabel(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** The icon description the user starts from; the server adds the grid framing. */
function buildDefaultPrompt(projectName: string): string {
  const trimmed = projectName.trim();
  return [
    `A flat vector app icon for${trimmed ? ` “${trimmed}”` : " a project"}.`,
    "One clear focal symbol that captures what the project does: bold simple shapes, high contrast, centered composition, solid background color, no text or borders.",
  ].join(" ");
}

const isCapableImageProvider = (provider: ServerProvider): boolean =>
  provider.supportsImageGeneration === true &&
  provider.enabled &&
  provider.installed &&
  provider.status === "ready" &&
  isProviderAvailable(provider);

function GeneratedIconTile({
  path,
  environmentId,
  workspaceRoot,
  selected,
  onSelect,
}: {
  readonly path: string;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const url = useAtomValue(
    projectFaviconUrlAtom({ environmentId, cwd: workspaceRoot, faviconPath: path }),
  );
  return (
    <button
      type="button"
      aria-label={`Generated icon ${path.split("/").at(-1) ?? path}`}
      aria-pressed={selected}
      className={cn(
        "flex size-24 items-center justify-center overflow-hidden rounded-lg border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-foreground/64",
      )}
      onClick={onSelect}
    >
      {url ? (
        <img src={url} alt="" className="size-full rounded-lg" />
      ) : (
        <span className="size-full rounded-lg bg-accent" />
      )}
    </button>
  );
}

export function ProjectIconPickerDialog({
  current,
  projectName,
  environmentId,
  workspaceRoot,
  providers,
  open,
  onOpenChange,
  onSelect,
  onSelectFile,
}: {
  readonly current: ProjectIconOverride | null;
  readonly projectName: string;
  readonly environmentId: EnvironmentId | null;
  readonly workspaceRoot: string;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (icon: ProjectIconOverride) => void;
  readonly onSelectFile: (path: string) => void;
}) {
  const automatic = deriveProjectIdentity(projectName);
  const [mode, setMode] = useState<ProjectIconOverride["kind"] | "monogram" | "generate">(
    current?.kind === "lucide" && current.monogram ? "monogram" : (current?.kind ?? "lucide"),
  );
  const [iconName, setIconName] = useState<IconName>(
    current?.kind === "lucide" ? (current.name as IconName) : DEFAULT_ICON,
  );
  const [color, setColor] = useState<ProjectIconColor>(
    current && current.kind !== "emoji" ? current.color : automatic.color,
  );
  const [letters, setLetters] = useState(
    current?.kind === "lucide" && current.monogram ? current.monogram : automatic.monogram,
  );
  const [emoji, setEmoji] = useState(current?.kind === "emoji" ? current.emoji : "💻");
  const [query, setQuery] = useState("");
  const [customEmoji, setCustomEmoji] = useState("");
  const [vibe, setVibe] = useState("");
  const [prompt, setPrompt] = useState(() => buildDefaultPrompt(projectName));
  const [generating, setGenerating] = useState(false);
  const [generatedPaths, setGeneratedPaths] = useState<ReadonlyArray<string> | null>(null);
  const [selectedIconPath, setSelectedIconPath] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const generateIcons = useAtomCommand(serverEnvironment.generateProjectIcons, {
    reportFailure: false,
  });
  const previousOpenRef = useRef(false);

  useEffect(() => {
    if (open && !previousOpenRef.current) {
      setMode(
        current?.kind === "lucide" && current.monogram ? "monogram" : (current?.kind ?? "lucide"),
      );
      setIconName(current?.kind === "lucide" ? (current.name as IconName) : DEFAULT_ICON);
      setColor(current && current.kind !== "emoji" ? current.color : automatic.color);
      setLetters(
        current?.kind === "lucide" && current.monogram ? current.monogram : automatic.monogram,
      );
      setEmoji(current?.kind === "emoji" ? current.emoji : "💻");
      setQuery("");
      setCustomEmoji("");
      setVibe("");
      setPrompt(buildDefaultPrompt(projectName));
      setGenerating(false);
      setGeneratedPaths(null);
      setSelectedIconPath(null);
      setGenerationError(null);
    }
    previousOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, open, automatic.color, automatic.monogram, projectName]);

  const icons = useMemo(() => filterProjectIconNames(query), [query]);
  const selectedColorClassName = projectIconColorClassName(color);
  const monogram = letters.normalize("NFKC").trim().toUpperCase();
  const validMonogram = isMonogramText(monogram);
  const capableProvider = useMemo(
    () => providers.find(isCapableImageProvider) ?? null,
    [providers],
  );
  const trimmedPrompt = prompt.trim();
  const save = () => {
    if (mode === "monogram" && !validMonogram) return;
    if (mode === "generate") {
      if (selectedIconPath) onSelectFile(selectedIconPath);
      onOpenChange(false);
      return;
    }
    onSelect(
      mode === "monogram"
        ? { kind: "lucide", name: DEFAULT_ICON, monogram, color }
        : mode === "lucide"
          ? { kind: "lucide", name: iconName, color }
          : { kind: "emoji", emoji },
    );
    onOpenChange(false);
  };
  const generate = async () => {
    if (!environmentId || !capableProvider || generating || !trimmedPrompt) return;
    setGenerating(true);
    setGenerationError(null);
    setGeneratedPaths(null);
    setSelectedIconPath(null);
    try {
      const result = await generateIcons({
        environmentId,
        input: {
          prompt: trimmedPrompt,
          ...(vibe.trim() ? { vibe: vibe.trim() } : {}),
        },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setGenerationError(
            error instanceof Error ? error.message : "The provider could not generate icons.",
          );
        }
        return;
      }
      const { iconPaths } = result.value;
      setGeneratedPaths(iconPaths);
      if (iconPaths.length === 1) setSelectedIconPath(iconPaths[0]!);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="w-full sm:w-[32rem]">
        <DialogHeader>
          <DialogTitle>Choose project icon</DialogTitle>
          <DialogDescription>Choose an icon, emoji, monogram, or generate one.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col gap-4">
          <ToggleGroup
            aria-label="Icon type"
            variant="segmented"
            value={[mode]}
            onValueChange={(next) => {
              const value = next[0];
              if (
                value === "lucide" ||
                value === "emoji" ||
                value === "monogram" ||
                value === "generate"
              ) {
                setMode(value);
              }
            }}
          >
            <Toggle value="lucide">Icons</Toggle>
            <Toggle value="emoji">Emoji</Toggle>
            <Toggle value="monogram">Monogram</Toggle>
            <Toggle value="generate">Generate</Toggle>
          </ToggleGroup>

          {mode !== "emoji" && mode !== "generate" ? (
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Color</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Icon color">
                {PROJECT_ICON_COLORS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={color === option.value}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      color === option.value && "border-foreground/64",
                    )}
                    onClick={() => setColor(option.value)}
                  >
                    <span className={cn("size-4 rounded-full", option.swatchClassName)} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {mode === "lucide" ? (
            <>
              <Input
                type="search"
                value={query}
                aria-label="Search Lucide icons"
                placeholder="Search all Lucide icons"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <ScrollArea scrollFade className="max-h-64">
                <div className="grid grid-cols-8 gap-1 p-0.5 sm:grid-cols-10">
                  {icons.map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-label={iconLabel(name)}
                      aria-pressed={iconName === name}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md border border-transparent outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        iconName === name && "border-border bg-accent",
                        selectedColorClassName,
                      )}
                      onClick={() => setIconName(name)}
                    >
                      <DynamicIcon name={name} className="size-5" />
                    </button>
                  ))}
                </div>
              </ScrollArea>
              {icons.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No icons found.</p>
              ) : null}
            </>
          ) : mode === "monogram" ? (
            <div className="flex items-center gap-4 py-2">
              <ProjectMonogram
                text={validMonogram ? monogram : automatic.monogram}
                color={color}
                className="size-12"
              />
              <div className="flex-1 space-y-2">
                <label htmlFor="project-monogram" className="text-sm font-medium">
                  Letters
                </label>
                <Input
                  id="project-monogram"
                  value={letters}
                  onChange={(event) => setLetters(event.currentTarget.value)}
                  aria-describedby="project-monogram-hint"
                  aria-invalid={!validMonogram}
                  autoComplete="off"
                />
                <p id="project-monogram-hint" className="text-xs text-muted-foreground">
                  One or two letters or numbers.
                </p>
              </div>
            </div>
          ) : mode === "generate" ? (
            <div className="space-y-3">
              {capableProvider ? (
                <>
                  <div className="space-y-2">
                    <div>
                      <label htmlFor="project-icon-vibe" className="text-sm font-medium">
                        Vibe
                      </label>
                      <Input
                        id="project-icon-vibe"
                        value={vibe}
                        aria-describedby="project-icon-vibe-hint"
                        placeholder="e.g. playful, neon, minimalist"
                        autoComplete="off"
                        onChange={(event) => setVibe(event.currentTarget.value)}
                      />
                      <p id="project-icon-vibe-hint" className="mt-1 text-xs text-muted-foreground">
                        The overall look to aim for.
                      </p>
                    </div>
                    <Collapsible>
                      <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                        <ChevronDownIcon className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
                        Edit prompt
                      </CollapsibleTrigger>
                      <CollapsiblePanel>
                        <Textarea
                          value={prompt}
                          aria-label="Icon prompt"
                          rows={4}
                          className="mt-2"
                          onChange={(event) => setPrompt(event.currentTarget.value)}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          What the icon should depict. Three variants are generated from this.
                        </p>
                      </CollapsiblePanel>
                    </Collapsible>
                  </div>
                  {generatedPaths && generatedPaths.length > 0 ? (
                    <div>
                      <div className="mb-2 text-xs font-medium text-muted-foreground">Pick one</div>
                      <div className="flex gap-2">
                        {generatedPaths.map((path) => (
                          <GeneratedIconTile
                            key={path}
                            path={path}
                            environmentId={environmentId!}
                            workspaceRoot={workspaceRoot}
                            selected={selectedIconPath === path}
                            onSelect={() => setSelectedIconPath(path)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {generationError ? (
                    <p className="text-xs text-destructive" role="alert">
                      {generationError}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={generating || !trimmedPrompt}
                    onClick={() => void generate()}
                  >
                    <SparklesIcon className="size-4" />
                    {generating ? "Generating…" : generatedPaths ? "Regenerate" : "Generate"}
                  </Button>
                </>
              ) : (
                <div className="rounded-lg border border-border bg-accent/40 p-3 text-sm">
                  <p className="font-medium">AI icon generation is not available yet.</p>
                  <p className="mt-1 text-muted-foreground">
                    You need a provider that supports image generation, such as Codex. Add and sign
                    in to one under Settings → Connections.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              <ScrollArea scrollFade className="max-h-64">
                <div className="grid grid-cols-8 gap-1 p-0.5 sm:grid-cols-10">
                  {PROJECT_EMOJIS.map((option) => (
                    <button
                      key={option.emoji}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={emoji === option.emoji}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md border border-transparent text-xl outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        emoji === option.emoji && "border-border bg-accent",
                      )}
                      onClick={() => setEmoji(option.emoji)}
                    >
                      {option.emoji}
                    </button>
                  ))}
                </div>
              </ScrollArea>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Or paste any emoji
                </div>
                <Input
                  value={customEmoji}
                  aria-label="Custom emoji"
                  placeholder="Paste an emoji"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCustomEmoji(value);
                    const nextEmoji = firstEmoji(value);
                    if (nextEmoji) setEmoji(nextEmoji);
                  }}
                />
              </div>
            </>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={
              mode === "generate" ? !selectedIconPath : mode === "monogram" && !validMonogram
            }
          >
            Save icon
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
