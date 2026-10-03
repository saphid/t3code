// Drives the view hosts by hand: the `probe` view calls these handlers.
export function activate(context) {
  // Calls that a frame forged around its port; a host that drops them never delivers one.
  let forged = 0;
  context.proposed.handle("view:probe:echo", (input) => {
    if (typeof input === "object" && input !== null && "forged" in input) forged += 1;
    return { echo: input };
  });
  context.proposed.handle("view:probe:forged", () => ({ forged }));
  context.proposed.handle(
    "view:probe:hang",
    (_input, { signal }) =>
      new Promise((resolve) => signal.addEventListener("abort", () => resolve(null))),
  );
}
