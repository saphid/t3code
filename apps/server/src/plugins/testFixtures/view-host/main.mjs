// Drives the web and desktop view host by hand: the `probe` view calls these handlers.
export function activate(context) {
  context.proposed.handle("view:probe:echo", (input) => ({ echo: input }));
  context.proposed.handle(
    "view:probe:hang",
    (_input, { signal }) =>
      new Promise((resolve) => signal.addEventListener("abort", () => resolve(null))),
  );
}
