import type * as React from "react";
import { isComponentType } from "./componentType.js";

export interface UiButtonProps extends React.ComponentPropsWithRef<"button"> {
  readonly variant?: "default" | "ghost" | "ghost-muted" | "outline" | "destructive";
  readonly size?: "default" | "compact" | "icon-xs" | "icon-sm" | "xs";
}

export interface UiTreeRowProps extends Omit<React.ComponentPropsWithRef<"button">, "children"> {
  readonly path: string;
  readonly depth: number;
  readonly directory: boolean;
  readonly expanded?: boolean;
  readonly selected?: boolean;
}

export type UiIconName =
  | "back"
  | "forward"
  | "refresh"
  | "more"
  | "external"
  | "camera"
  | "annotate"
  | "viewport"
  | "minus"
  | "plus"
  | "reset";

export interface ClientUiKit {
  readonly version: 1;
  readonly Button: React.ComponentType<UiButtonProps>;
  readonly Input: React.ComponentType<React.ComponentPropsWithRef<"input">>;
  readonly InputGroup: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  readonly Menu: React.ComponentType<{
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly children: React.ReactNode;
  }>;
  readonly MenuTrigger: React.ComponentType<
    Omit<React.ComponentPropsWithRef<"button">, "children"> & {
      readonly children: React.ReactElement;
    }
  >;
  readonly MenuPopup: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  readonly MenuSub: React.ComponentType<{ readonly children: React.ReactNode }>;
  readonly MenuSubTrigger: React.ComponentType<
    React.HTMLAttributes<HTMLDivElement> & { readonly disabled?: boolean }
  >;
  readonly MenuSubPopup: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  readonly MenuItem: React.ComponentType<
    React.ComponentPropsWithRef<"div"> & {
      readonly disabled?: boolean;
      readonly closeOnClick?: boolean;
    }
  >;
  readonly MenuSeparator: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  readonly MenuGroupLabel: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  readonly MenuRadioGroup: React.ComponentType<{
    readonly value: string;
    readonly onValueChange: (value: string) => void;
    readonly children: React.ReactNode;
  }>;
  readonly MenuRadioItem: React.ComponentType<{
    readonly value: string;
    readonly disabled?: boolean;
    readonly children: React.ReactNode;
  }>;
  readonly TreeRow: React.ComponentType<UiTreeRowProps>;
  readonly Icon: React.ComponentType<{ readonly name: UiIconName; readonly className?: string }>;
}

const COMPONENTS = [
  "Button",
  "Input",
  "InputGroup",
  "Menu",
  "MenuTrigger",
  "MenuPopup",
  "MenuSub",
  "MenuSubTrigger",
  "MenuSubPopup",
  "MenuItem",
  "MenuSeparator",
  "MenuGroupLabel",
  "MenuRadioGroup",
  "MenuRadioItem",
  "TreeRow",
  "Icon",
] as const;

export function resolveUiKit(host: { readonly uiKit?: ClientUiKit }): ClientUiKit | null {
  const member: unknown = host.uiKit;
  if (member === null || typeof member !== "object") return null;
  const kit = member as Record<string, unknown>;
  if (!Number.isInteger(kit.version) || (kit.version as number) < 1) return null;
  return COMPONENTS.every((name) => isComponentType(kit[name])) ? (member as ClientUiKit) : null;
}
