import type { CSSProperties, Ref } from "react";

/**
 * The address a cancelled edit returns to: the workspace file on show (its
 * page URL is a minted lease), else the page the held session shows, else
 * the committed navigation target.
 */
export function committedAddress(input: {
  readonly fileSource: string | null;
  readonly pageUrl: string | null;
  readonly target: string | null;
}): string {
  return input.fileSource ?? input.pageUrl ?? input.target ?? "";
}

/**
 * The address field. Native keys: Enter submits the draft; Escape cancels
 * the edit — the draft returns to `committed` and focus leaves the field.
 */
export function AddressInput(props: {
  readonly value: string;
  readonly committed: string;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly inputRef: Ref<HTMLInputElement>;
  readonly style: CSSProperties;
}) {
  const { value, committed, onValueChange, onSubmit, inputRef, style } = props;
  return (
    <input
      type="text"
      aria-label="Address"
      placeholder="Search or enter address"
      ref={inputRef}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSubmit(value);
        if (event.key === "Escape") {
          event.preventDefault();
          onValueChange(committed);
          event.currentTarget.blur();
        }
      }}
      style={style}
    />
  );
}
