/**
 * Composer mic button (beta voice dictation).
 *
 * Mounted only when the beta flag is on and the browser can capture audio,
 * so the status RPC never fires for users who have not opted in. The button
 * renders nothing until the connected environment reports that it can
 * transcribe (macOS 26+ with the sidecar present).
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { MicIcon, SquareIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useVoiceDictation } from "~/hooks/useVoiceDictation";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function failureMessage(failure: unknown): string {
  return failure instanceof Error && failure.message.length > 0
    ? failure.message
    : "Voice transcription failed.";
}

export const ComposerVoiceDictation = memo(function ComposerVoiceDictation({
  environmentId,
  disabled,
  getSessionTerms,
  getInsertTarget,
  onText,
  onError,
}: {
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  /** Reads current-session vocabulary at stop time (draft, title, visible messages). */
  readonly getSessionTerms: () => ReadonlyArray<string>;
  /** Identity of the draft the transcript lands in; stale results are dropped. */
  readonly getInsertTarget: () => string | null;
  readonly onText: (text: string) => void;
  /** Publishes the latest dictation error (or clears it with null). */
  readonly onError: (message: string | null) => void;
}) {
  const statusResult = useAtomValue(
    serverEnvironment.voiceDictationStatus({ environmentId, input: {} }),
  );
  const dictationStatus = Option.getOrNull(AsyncResult.value(statusResult));
  const transcribeCommand = useAtomCommand(serverEnvironment.transcribeVoice, {
    reportFailure: false,
  });
  const installCommand = useAtomCommand(serverEnvironment.installVoiceDictation, {
    reportFailure: false,
  });
  const [isInstalling, setIsInstalling] = useState(false);
  const installingRef = useRef(false);
  /** Bails stale install continuations after unmount or an environment change. */
  const mountedRef = useRef(true);
  const installGenerationRef = useRef(0);
  const environmentIdRef = useRef(environmentId);
  environmentIdRef.current = environmentId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const transcribe = useCallback(
    async ({ audioBase64, mimeType }: { audioBase64: string; mimeType: string }) => {
      const result = await transcribeCommand({
        environmentId,
        input: {
          audioBase64,
          mimeType,
          sessionTerms: getSessionTerms(),
        },
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return "";
        throw new Error(failureMessage(squashAtomCommandFailure(result)));
      }
      return result.value.text;
    },
    [environmentId, getSessionTerms, transcribeCommand],
  );

  const voice = useVoiceDictation({ transcribe, onText, getInsertTarget });
  const { start, error } = voice;

  // The hook owns the error text; mirror it up so the composer can show it in
  // its usual validation slot instead of squeezing prose into the footer.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    onErrorRef.current(error);
  }, [error]);

  const beginDictation = useCallback(() => {
    onError(null);
    if (dictationStatus?.installed !== true) {
      // First use on this environment: download the on-device dictation
      // assets, then start listening. Re-entry joins the pending install.
      if (installingRef.current) return;
      installingRef.current = true;
      setIsInstalling(true);
      const generation = (installGenerationRef.current += 1);
      const targetEnvironmentId = environmentId;
      void (async () => {
        const result = await installCommand({
          environmentId: targetEnvironmentId,
          input: {},
        });
        installingRef.current = false;
        appAtomRegistry.refresh(
          serverEnvironment.voiceDictationStatus({
            environmentId: targetEnvironmentId,
            input: {},
          }),
        );
        if (mountedRef.current) setIsInstalling(false);
        // The continuation reports errors and can open the mic; a stale one
        // (unmounted button, newer attempt, or a different environment
        // connected meanwhile) must do neither.
        if (
          !mountedRef.current ||
          installGenerationRef.current !== generation ||
          environmentIdRef.current !== targetEnvironmentId
        ) {
          return;
        }
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            onError(failureMessage(squashAtomCommandFailure(result)));
          }
          return;
        }
        if (result.value.installed) void start();
      })();
      return;
    }
    void start();
  }, [dictationStatus?.installed, environmentId, installCommand, onError, start]);

  // Unsupported environments (or a status that has not answered yet) get no
  // dead button: dictation quietly does not exist there.
  if (dictationStatus?.supported !== true) return null;

  if (voice.status === "transcribing" || isInstalling) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled
              aria-label={isInstalling ? "Preparing dictation" : "Transcribing"}
              data-chat-composer-voice="busy"
            >
              <Spinner className="size-4" />
            </Button>
          }
        />
        <TooltipPopup side="top">
          {isInstalling ? "Downloading dictation assets…" : "Transcribing…"}
        </TooltipPopup>
      </Tooltip>
    );
  }

  if (voice.status === "recording") {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1.5 px-2 text-destructive hover:text-destructive"
        onClick={voice.stop}
        aria-label="Stop dictation"
        data-chat-composer-voice="recording"
      >
        <SquareIcon className="size-3.5 animate-pulse fill-current" />
        <span className="text-xs tabular-nums">{formatElapsed(voice.elapsedMs)}</span>
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            onClick={beginDictation}
            aria-label="Dictate"
            data-chat-composer-voice="idle"
          >
            <MicIcon className={cn("size-4", disabled && "opacity-50")} />
          </Button>
        }
      />
      <TooltipPopup side="top">Dictate</TooltipPopup>
    </Tooltip>
  );
});
