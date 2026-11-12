import type { ThreadId, UsageProject } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

export class UsageProjectAttributionReadError extends Schema.TaggedError<UsageProjectAttributionReadError>()(
  "UsageProjectAttributionReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read provider session projects for usage.";
  }
}

export const sessionKey = (driver: string, nativeId: string) => `${driver}\u0000${nativeId}`;

export interface UsageSessionAttribution {
  readonly project: UsageProject;
  readonly threadId?: ThreadId;
  readonly threadTitle?: string;
}

/** Keyed by `sessionKey`. A session claimed by different projects belongs to neither. */
export function projectsBySession(
  rows: ReadonlyArray<ProjectStore.ProviderSessionProjectRow>,
): ReadonlyMap<string, UsageSessionAttribution> {
  const claimed = new Map<string, UsageSessionAttribution | null>();
  for (const row of rows) {
    const key = sessionKey(row.driver, row.nativeId);
    const existing = claimed.get(key);
    if (existing !== undefined) {
      if (existing === null) continue;
      if (existing.project.projectId !== row.projectId) claimed.set(key, null);
      else if (existing.threadId !== row.threadId) claimed.set(key, { project: existing.project });
      continue;
    }
    const title =
      row.projectTitle.trim() ||
      row.workspaceRoot.split(/[\\/]/).findLast((part) => part.length > 0) ||
      "Untitled project";
    const threadTitle = row.threadTitle?.trim() || undefined;
    claimed.set(key, {
      project: { projectId: row.projectId, title },
      threadId: row.threadId,
      ...(threadTitle === undefined ? {} : { threadTitle }),
    });
  }
  const attributions = new Map<string, UsageSessionAttribution>();
  for (const [key, attribution] of claimed)
    if (attribution !== null) attributions.set(key, attribution);
  return attributions;
}

export class UsageProjectAttribution extends Context.Service<
  UsageProjectAttribution,
  {
    /** Keyed by `sessionKey`; deleted projects keep their past usage. */
    readonly read: Effect.Effect<
      ReadonlyMap<string, UsageSessionAttribution>,
      UsageProjectAttributionReadError
    >;
  }
>()("t3/usage/UsageProjectAttribution") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const read = projects.listProviderSessionProjects().pipe(
    Effect.map(projectsBySession),
    Effect.mapError((cause) => new UsageProjectAttributionReadError({ cause })),
    Effect.withSpan("UsageProjectAttribution.read"),
  );
  return UsageProjectAttribution.of({ read });
});

export const layer = Layer.effect(UsageProjectAttribution, make);
