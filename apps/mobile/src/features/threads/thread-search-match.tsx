import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";

function foldAsciiCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function splitHighlightParts(text: string, queries: ReadonlyArray<string>) {
  const normalizedText = foldAsciiCase(text);
  const normalizedQueries = queries
    .map((query) => foldAsciiCase(query.trim()))
    .filter((query) => query.length > 0);
  if (normalizedQueries.length === 0) {
    return [{ text, highlighted: false, start: 0 }];
  }

  const parts: Array<{
    readonly text: string;
    readonly highlighted: boolean;
    readonly start: number;
  }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const nextMatch = normalizedQueries.reduce<{
      readonly index: number;
      readonly length: number;
    } | null>((earliest, query) => {
      const index = normalizedText.indexOf(query, cursor);
      if (index === -1 || (earliest !== null && earliest.index <= index)) return earliest;
      return { index, length: query.length };
    }, null);
    const matchIndex = nextMatch?.index ?? -1;
    if (matchIndex === -1) {
      parts.push({ text: text.slice(cursor), highlighted: false, start: cursor });
      break;
    }
    if (matchIndex > cursor) {
      parts.push({
        text: text.slice(cursor, matchIndex),
        highlighted: false,
        start: cursor,
      });
    }
    parts.push({
      text: text.slice(matchIndex, matchIndex + (nextMatch?.length ?? 0)),
      highlighted: true,
      start: matchIndex,
    });
    cursor = matchIndex + (nextMatch?.length ?? 0);
  }
  return parts;
}

export function ThreadSearchMatchExcerpt(props: {
  readonly match: EnvironmentThreadSearchMatch;
  readonly query: string;
  readonly selected?: boolean;
  readonly compact?: boolean;
}) {
  const isUser = props.match.source === "user";
  const parts = splitHighlightParts(props.match.snippet, props.match.matchedTerms ?? [props.query]);
  return (
    <Text
      className={cn(
        props.compact ? "text-sm" : "text-xs",
        props.selected ? "text-user-bubble-foreground-muted" : "text-foreground-muted",
      )}
      numberOfLines={1}
    >
      <Text
        className={cn(
          props.compact ? "text-sm font-t3-medium" : "text-xs font-t3-medium",
          props.selected
            ? "text-user-bubble-foreground"
            : isUser
              ? "text-adaptive-blue-500-400"
              : "text-adaptive-emerald-600-400",
        )}
      >
        {isUser ? "You:" : "Agent:"}{" "}
      </Text>
      {parts.map((part) => (
        <Text
          className={cn(
            props.compact ? "text-sm" : "text-xs",
            part.highlighted && "font-t3-bold",
            props.selected
              ? "text-user-bubble-foreground"
              : part.highlighted
                ? "text-foreground"
                : "text-foreground-muted",
          )}
          key={part.start}
        >
          {part.text}
        </Text>
      ))}
    </Text>
  );
}
