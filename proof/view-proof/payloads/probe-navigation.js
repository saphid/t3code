// Tries to leave the frame: navigate the app, open windows, submit forms.
(async () => {
  const { port, init } = await window.t3View.port;
  const results = [];
  const attempt = async (name, run) => {
    try {
      const detail = await run();
      results.push({ name, outcome: detail === undefined ? "blocked" : "LEAKED", detail: String(detail) });
    } catch (error) {
      results.push({ name, outcome: "blocked", detail: error.name + ": " + error.message });
    }
  };
  const hijack = init.appOrigin + "/#view-hijacked";
  await attempt("window.open", () => { const opened = window.open("https://example.com/", "_blank"); return opened ? "opened" : undefined; });
  await attempt("top.location assign", () => { top.location.href = hijack; return "assigned (host verifies URL)"; });
  await attempt("parent.location.replace", () => { parent.location.replace(hijack); return "replaced (host verifies URL)"; });
  await attempt("anchor target=_top click", () => {
    const anchor = document.createElement("a");
    anchor.href = hijack;
    anchor.target = "_top";
    document.body.append(anchor);
    anchor.click();
    return undefined;
  });
  await attempt("anchor target=_blank click", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://example.com/";
    anchor.target = "_blank";
    document.body.append(anchor);
    anchor.click();
    return undefined;
  });
  await attempt("form submit target=_top", () => {
    const form = document.createElement("form");
    form.action = hijack;
    form.target = "_top";
    document.body.append(form);
    form.submit();
    return undefined;
  });
  port.postMessage({ type: "report", results });
})();
