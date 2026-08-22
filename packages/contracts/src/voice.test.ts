import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ClientSettingsSchema } from "./settings.ts";
import {
  VOICE_AUDIO_BASE64_MAX_LENGTH,
  VOICE_SESSION_TERM_MAX_LENGTH,
  VOICE_SESSION_TERMS_MAX_ITEMS,
  VoiceDictationStatus,
  VoiceLocaleHint,
  VoiceTranscribeInput,
  VoiceTranscribeResult,
} from "./voice.ts";

const decodeStatus = Schema.decodeUnknownSync(VoiceDictationStatus);
const decodeTranscribeInput = Schema.decodeUnknownSync(VoiceTranscribeInput);
const decodeTranscribeResult = Schema.decodeUnknownSync(VoiceTranscribeResult);
const decodeLocaleHint = Schema.decodeUnknownSync(VoiceLocaleHint);
const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

describe("VoiceDictationStatus", () => {
  it("decodes a sidecar status", () => {
    expect(decodeStatus({ supported: true, installed: false, locale: "en-AU" })).toEqual({
      supported: true,
      installed: false,
      locale: "en-AU",
    });
  });
});

describe("VoiceLocaleHint", () => {
  it.each(["en", "en_AU", "en-AU", "fr_FR"])("accepts %s", (locale) => {
    expect(decodeLocaleHint(locale)).toBe(locale);
  });

  it.each(["", "english", "en_AU; rm -rf /", "zh-Hans-CN", "e1"])("rejects %s", (locale) => {
    expect(() => decodeLocaleHint(locale)).toThrow();
  });
});

describe("VoiceTranscribeInput", () => {
  it("requires non-empty audio", () => {
    expect(() =>
      decodeTranscribeInput({ audioBase64: "", mimeType: "audio/wav", sessionTerms: [] }),
    ).toThrow();
  });

  it("caps sessionTerms at the recognizer limit", () => {
    const oversized = Array.from({ length: VOICE_SESSION_TERMS_MAX_ITEMS + 1 }, () => "term");
    expect(() =>
      decodeTranscribeInput({
        audioBase64: "UklGRg==",
        mimeType: "audio/wav",
        sessionTerms: oversized,
      }),
    ).toThrow();

    const atLimit = Array.from({ length: VOICE_SESSION_TERMS_MAX_ITEMS }, () => "term");
    expect(
      decodeTranscribeInput({
        audioBase64: "UklGRg==",
        mimeType: "audio/wav",
        sessionTerms: atLimit,
      }).sessionTerms,
    ).toHaveLength(VOICE_SESSION_TERMS_MAX_ITEMS);
  });

  it("rejects audio whose base64 length exceeds the schema cap", () => {
    const oversized = "A".repeat(VOICE_AUDIO_BASE64_MAX_LENGTH + 1);
    expect(() =>
      decodeTranscribeInput({ audioBase64: oversized, mimeType: "audio/wav", sessionTerms: [] }),
    ).toThrow();

    const atLimit = "A".repeat(VOICE_AUDIO_BASE64_MAX_LENGTH);
    expect(
      decodeTranscribeInput({ audioBase64: atLimit, mimeType: "audio/wav", sessionTerms: [] })
        .audioBase64,
    ).toHaveLength(VOICE_AUDIO_BASE64_MAX_LENGTH);
  });

  it("rejects session terms that are empty or too long, and trims padding", () => {
    const decode = (sessionTerms: ReadonlyArray<string>) =>
      decodeTranscribeInput({ audioBase64: "UklGRg==", mimeType: "audio/wav", sessionTerms });

    expect(() => decode([""])).toThrow();
    expect(() => decode(["   "])).toThrow();
    expect(() => decode(["x".repeat(VOICE_SESSION_TERM_MAX_LENGTH + 1)])).toThrow();
    expect(decode([" worktree "]).sessionTerms).toEqual(["worktree"]);
    expect(decode(["x".repeat(VOICE_SESSION_TERM_MAX_LENGTH)]).sessionTerms).toHaveLength(1);
  });

  it("accepts an optional locale hint", () => {
    const decoded = decodeTranscribeInput({
      audioBase64: "UklGRg==",
      mimeType: "audio/wav",
      localeHint: "en_AU",
      sessionTerms: ["worktree"],
    });
    expect(decoded.localeHint).toBe("en_AU");
  });
});

describe("VoiceTranscribeResult", () => {
  it("rejects a negative vocabulary count", () => {
    expect(() => decodeTranscribeResult({ text: "hello", vocabularyCount: -1 })).toThrow();
    expect(decodeTranscribeResult({ text: "hello", vocabularyCount: 3 }).vocabularyCount).toBe(3);
  });
});

describe("ClientSettings voice dictation", () => {
  it("defaults the beta flag off", () => {
    expect(decodeClientSettings({}).voiceDictationEnabled).toBe(false);
  });

  it("round-trips an explicit opt-in", () => {
    expect(decodeClientSettings({ voiceDictationEnabled: true }).voiceDictationEnabled).toBe(true);
  });
});
