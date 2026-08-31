import {
  DEFAULT_TEXT_GENERATION_MODEL,
  ProviderInstanceId,
  type ModelSelection,
  type OrchestrationThread,
} from "@t3tools/contracts";

export const HANDOVER_MODEL_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: DEFAULT_TEXT_GENERATION_MODEL,
  options: [{ id: "reasoningEffort", value: "high" }],
};

export function formatThreadForHandover(thread: OrchestrationThread): string {
  const metadata = [
    `Title: ${thread.title}`,
    `Branch: ${thread.branch ?? "none"}`,
    `Worktree: ${thread.worktreePath ?? "project checkout"}`,
  ];
  const messages = thread.messages.map(
    (message) => `## ${message.role === "user" ? "User" : "Assistant"}\n\n${message.text}`,
  );
  return ["# Thread metadata", ...metadata, "", "# Conversation", ...messages].join("\n");
}
