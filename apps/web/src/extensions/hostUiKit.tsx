import type { ClientUiKit, UiIconName, UiTreeRowProps } from "@t3tools/extension-sdk/ui";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ExternalLink,
  Minus,
  Monitor,
  MoreVertical,
  MousePointerClick,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useEffect } from "react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { ensurePierreIconSprite, resolvePierreIconForEntry } from "~/pierre-icons";

const icons = {
  back: ArrowLeft,
  forward: ArrowRight,
  refresh: RefreshIcon,
  more: MoreVertical,
  external: ExternalLink,
  camera: Camera,
  annotate: MousePointerClick,
  viewport: Monitor,
  minus: Minus,
  plus: Plus,
  reset: RotateCcw,
};

function Icon({ name, className }: { name: UiIconName; className?: string }) {
  const Component = icons[name];
  return <Component aria-hidden className={className ?? "size-3.5"} />;
}

function TreeRow({
  path,
  depth,
  directory,
  expanded,
  selected,
  className,
  style,
  ...props
}: UiTreeRowProps) {
  useEffect(ensurePierreIconSprite, []);
  const icon = resolvePierreIconForEntry(path, directory ? "directory" : "file");
  return (
    <button
      type="button"
      role="treeitem"
      data-slot="extension-tree-row"
      aria-level={depth + 1}
      aria-selected={selected === true}
      aria-expanded={directory ? expanded === true : undefined}
      className={`relative flex h-full w-full items-center overflow-hidden rounded-[5px] border-0 text-left text-xs text-[var(--contrast-foreground)] outline-none hover:bg-[color-mix(in_srgb,currentColor_7%,transparent)] focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring aria-selected:bg-[color-mix(in_srgb,currentColor_12%,transparent)] ${className ?? ""}`}
      style={{
        padding: "0 6.4px",
        paddingLeft: 6.4 + depth * 19.2,
        gap: 4.8,
        lineHeight: "24px",
        ...style,
      }}
      {...props}
    >
      <svg
        aria-hidden
        className={`size-4 shrink-0 ${directory && expanded ? "rotate-90" : ""}`}
        viewBox="0 0 32 32"
      >
        <use href={`#${directory ? "file-tree-icon-chevron" : icon?.name}`} />
      </svg>
      <span className="truncate">{path.split("/").at(-1)}</span>
    </button>
  );
}

export const hostUiKit: ClientUiKit = {
  version: 1,
  Button,
  Input: ({ size, ...props }) => <InputGroupInput size={size ?? "sm"} {...props} />,
  InputGroup: (props) => <InputGroup variant="ghost" className="h-7 min-w-0 flex-1" {...props} />,
  Menu,
  MenuTrigger: ({ children, ...props }) => <MenuTrigger render={children} {...props} />,
  MenuPopup: (props) => (
    <MenuPopup align="end" sideOffset={6} {...props} data-t3-browser-surface-overlay="" />
  ),
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup: (props) => <MenuSubPopup {...props} data-t3-browser-surface-overlay="" />,
  MenuItem,
  MenuSeparator,
  MenuGroupLabel,
  MenuRadioGroup,
  MenuRadioItem,
  TreeRow,
  Icon,
};
