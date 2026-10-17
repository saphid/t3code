import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import type { PullRequestActor } from "@t3tools/contracts";
import { Image } from "expo-image";
import { Linking, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { EmptyState } from "../../components/ui/EmptyState";
import { useProject } from "../../state/entities";
import { nativePullRequestBrowserLink } from "../../lib/pullRequestNavigation";
import { openOnProviderLabel } from "./pullRequestActions";
import { pullRequestTarget, type PullRequestParams } from "./usePullRequestDiff";

export function PullRequestReadStatus(props: {
  readonly params: PullRequestParams;
  readonly pending: boolean;
  readonly error: string | null;
}) {
  const target = pullRequestTarget(props.params);
  const project = useProject({
    environmentId: target.environmentId,
    projectId: target.input.projectId,
  });
  const link = nativePullRequestBrowserLink(props.params, project?.repositoryIdentity);
  return props.pending ? (
    <AppActivityIndicator className="my-12" colorClassName="accent-icon" />
  ) : props.error ? (
    <EmptyState
      title="Couldn't load this pull request"
      detail={props.error}
      variant="plain"
      actionLabel={link ? openOnProviderLabel(link.provider) : undefined}
      onAction={link ? () => void Linking.openURL(link.url) : undefined}
    />
  ) : null;
}

export function PullRequestAvatar(props: {
  readonly actor: PullRequestActor | null;
  readonly size?: number;
}) {
  const size = props.size ?? 24;
  return props.actor?.avatarUrl ? (
    <Image
      source={{ uri: props.actor.avatarUrl }}
      recyclingKey={props.actor.avatarUrl}
      accessibilityLabel={props.actor.login}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      cachePolicy="memory-disk"
    />
  ) : (
    <View
      className="items-center justify-center rounded-full bg-grouped-card"
      style={{ width: size, height: size }}
    >
      <Text className="font-t3-medium text-foreground-muted" style={{ fontSize: size * 0.45 }}>
        {props.actor?.login.slice(0, 1).toUpperCase() ?? "?"}
      </Text>
    </View>
  );
}

export function PullRequestDiffStats(props: {
  readonly additions: number;
  readonly deletions: number;
  readonly compact?: boolean;
}) {
  const textSize = props.compact ? "text-2xs" : "text-xs";
  return (
    <View className="shrink-0 flex-row items-center gap-2">
      {!props.compact || props.additions > 0 ? (
        <Text className={cn(textSize, "font-t3-medium tabular-nums text-adaptive-emerald-600-400")}>
          +{props.additions.toLocaleString()}
        </Text>
      ) : null}
      {!props.compact || props.deletions > 0 ? (
        <Text className={cn(textSize, "font-t3-medium tabular-nums text-danger-foreground")}>
          −{props.deletions.toLocaleString()}
        </Text>
      ) : null}
    </View>
  );
}
