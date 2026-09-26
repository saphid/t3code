/**
 * The page menu's profile group — the package counterpart of the native
 * "Profile: <name>" heading with Clear cookies / Clear cache, plus opening
 * the page in another profile and the settings "Import from" flow. Each
 * control rides its own `t3.browser/profiles` grant; a refusal names the
 * missing grant (or desktop-required) in the group's note or the status
 * line, and pending work is static text — no spinner.
 */
import { bindApi } from "@t3tools/extension-sdk/capabilities";
import {
  browserProfilesApi,
  type BrowserImportSourceSummary,
  type BrowserProfileList,
  type BrowserSession,
} from "@t3tools/extension-sdk/catalogue";
import type { ViewContext } from "@t3tools/extension-sdk/contracts";
import type { ClientHost } from "@t3tools/extension-sdk/environment";
import { useEffect, useState } from "react";

import {
  clearResultMessage,
  importableSources,
  importResultMessage,
  profileFailureMessage,
  profileLabel,
  sessionProfileId,
  type ProfileAction,
} from "./profiles.js";

export const bindProfilesApi = (host: ClientHost, context: ViewContext) =>
  bindApi(browserProfilesApi, host, context);
type ProfilesApi = ReturnType<typeof bindProfilesApi>;

const muted = "var(--t3-browser-muted-foreground, var(--muted-foreground, #667085))";
const border = "1px solid var(--t3-browser-border, var(--border, #dfe3e8))";
const control = {
  font: "inherit",
  fontSize: 12,
  padding: "2px 8px",
  border,
  borderRadius: 5,
  background: "transparent",
  color: "inherit",
} as const;

type Importer =
  | { readonly kind: "closed" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly sources: readonly BrowserImportSourceSummary[];
      readonly sourceId: string;
      readonly handle: string;
    };

const PENDING: Partial<Record<ProfileAction, string>> = {
  clearCookies: "Clearing cookies…",
  clearCache: "Clearing the cache…",
  importCookies: "Importing — confirm the import in the T3 Code desktop app.",
};

const firstProfile = (sources: readonly BrowserImportSourceSummary[], sourceId: string) =>
  sources.find((source) => source.id === sourceId)?.profiles[0]?.handle ?? "";

export function ProfileSection(props: {
  session: BrowserSession;
  api: ProfilesApi;
  signal: AbortSignal;
  /** Opens the current page in a new session under `profileId` (a profile is fixed at open). */
  onOpenInProfile: (profileId: string) => void;
  /** Puts a finished action's named result on the panel's status line. */
  report: (message: string) => void;
}) {
  const { session, api, signal, onOpenInProfile, report } = props;
  const profileId = sessionProfileId(session);
  const [list, setList] = useState<BrowserProfileList | null>(null);
  const [listNote, setListNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<ProfileAction | null>(null);
  const [importer, setImporter] = useState<Importer>({ kind: "closed" });

  // One read per menu open: the list is the desktop's settings, which can
  // change between opens.
  useEffect(() => {
    let live = true;
    void api.invoke("list", {}, signal).then(
      (value) => {
        if (live) setList(value);
      },
      (error: unknown) => {
        if (live) setListNote(profileFailureMessage("list", error));
      },
    );
    return () => {
      live = false;
    };
  }, [api, signal]);

  const name = profileLabel(list, profileId);

  const clear = (kind: "clearCookies" | "clearCache") => {
    setBusy(kind);
    void api
      .invoke(kind, { profileId }, signal)
      .then(
        (result) => report(clearResultMessage(result, kind, name)),
        (error: unknown) => report(profileFailureMessage(kind, error)),
      )
      .finally(() => setBusy(null));
  };

  const openImporter = () => {
    setImporter({ kind: "loading" });
    void api.invoke("listImportSources", {}, signal).then(
      ({ sources }) => {
        const usable = importableSources(sources);
        const sourceId = usable[0]?.id ?? "";
        setImporter({
          kind: "ready",
          sources: usable,
          sourceId,
          handle: firstProfile(usable, sourceId),
        });
      },
      (error: unknown) =>
        setImporter({ kind: "failed", message: profileFailureMessage("listImportSources", error) }),
    );
  };

  const runImport = (sourceId: string, handle: string) => {
    setBusy("importCookies");
    void api
      .invoke("importCookies", { profileId, sourceId, sourceProfile: handle }, signal)
      .then(
        (result) => {
          report(importResultMessage(result, name));
          if (result.outcome === "imported") setImporter({ kind: "closed" });
        },
        (error: unknown) => report(profileFailureMessage("importCookies", error)),
      )
      .finally(() => setBusy(null));
  };

  const others = list?.profiles.filter((profile) => profile.id !== profileId) ?? [];
  const selectedSource =
    importer.kind === "ready"
      ? importer.sources.find((source) => source.id === importer.sourceId)
      : undefined;

  return (
    <div
      role="group"
      aria-label="Profile"
      style={{ display: "grid", gap: 6, borderTop: border, paddingTop: 8 }}
    >
      <span
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: muted }}
      >
        Profile: {name}
      </span>
      {listNote && (
        <p role="note" style={{ margin: 0, color: muted }}>
          {listNote}
        </p>
      )}
      {others.length > 0 && (
        <label style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>Open page in</span>
          <select
            aria-label="Open page in profile"
            value=""
            onChange={(event) => {
              if (event.target.value) onOpenInProfile(event.target.value);
            }}
            style={{ ...control, maxWidth: 140 }}
          >
            <option value="">Choose…</option>
            {others.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        role="menuitem"
        disabled={busy !== null}
        onClick={() => clear("clearCookies")}
        style={{ ...control, textAlign: "left" }}
      >
        Clear cookies
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={busy !== null}
        onClick={() => clear("clearCache")}
        style={{ ...control, textAlign: "left" }}
      >
        Clear cache
      </button>
      {importer.kind === "closed" ? (
        <button
          type="button"
          role="menuitem"
          disabled={busy !== null}
          onClick={openImporter}
          style={{ ...control, textAlign: "left" }}
        >
          Import cookies…
        </button>
      ) : importer.kind === "loading" ? (
        <p role="note" style={{ margin: 0, color: muted }}>
          Listing browsers on the desktop…
        </p>
      ) : importer.kind === "failed" ? (
        <p role="note" style={{ margin: 0, color: muted }}>
          {importer.message}
        </p>
      ) : importer.sources.length === 0 ? (
        <p role="note" style={{ margin: 0, color: muted }}>
          No browser on the desktop can be imported from.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 4 }}>
          <select
            aria-label="Import from browser"
            value={importer.sourceId}
            onChange={(event) =>
              setImporter({
                ...importer,
                sourceId: event.target.value,
                handle: firstProfile(importer.sources, event.target.value),
              })
            }
            style={control}
          >
            {importer.sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
          {selectedSource?.unavailable ? (
            <p role="note" style={{ margin: 0, color: muted }}>
              {importResultMessage(
                { outcome: "failed", profileId, reason: selectedSource.unavailable },
                name,
              )}
            </p>
          ) : (
            <select
              aria-label="Import from browser profile"
              value={importer.handle}
              onChange={(event) => setImporter({ ...importer, handle: event.target.value })}
              style={control}
            >
              {selectedSource?.profiles.map((profile) => (
                <option key={profile.handle} value={profile.handle}>
                  {profile.cookieCount === undefined
                    ? profile.name
                    : `${profile.name} (${profile.cookieCount} cookies)`}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={
              busy !== null || !importer.handle || selectedSource?.unavailable !== undefined
            }
            onClick={() => runImport(importer.sourceId, importer.handle)}
            style={{ ...control, textAlign: "left" }}
          >
            Import into {name}
          </button>
        </div>
      )}
      {busy !== null && PENDING[busy] && (
        <p role="note" style={{ margin: 0, color: muted }}>
          {PENDING[busy]}
        </p>
      )}
    </div>
  );
}
