// Sets statuses and sends notifications on request, so PluginStatus.test.ts can check that
// they reach clients and are taken back when the process stops.
export function activate(context) {
  const { handle, status, notify } = context.proposed;
  handle("status", async (input) => {
    await status.set(input);
    return null;
  });
  handle("notify", async (input) => {
    await notify(input);
    return null;
  });
  handle("crash", () => process.exit(1));
}
