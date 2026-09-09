import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

export function control(props: {
  children?: ReactNode;
  render?: ReactElement | ((...args: never[]) => ReactNode);
  onClick?: () => void;
  onPressedChange?: (pressed: boolean) => void;
  pressed?: boolean;
  "aria-label"?: string;
}) {
  if (isValidElement(props.render)) return cloneElement(props.render, {}, props.children);
  return (
    <button
      onClick={
        props.onClick ??
        (props.onPressedChange ? () => props.onPressedChange?.(!props.pressed) : undefined)
      }
      aria-label={props["aria-label"]}
    >
      {props.children}
    </button>
  );
}
