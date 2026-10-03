// The host probe view. Each button exercises one host rule; the ids are what a capture checks.
const status = document.createElement("p");
status.id = "status";
status.textContent = "Connecting…";
const result = document.createElement("output");
result.id = "result";
document.body.append(status);

const button = (id, label, onClick) => {
  const element = document.createElement("button");
  element.id = id;
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  document.body.append(element);
};

let echoes = 0;
button("echo", "Echo", async () => {
  echoes += 1;
  try {
    const answer = await t3View.call("echo", { n: echoes });
    result.textContent = `echo ${echoes}: ${JSON.stringify(answer)}`;
  } catch (error) {
    result.textContent = `echo ${echoes} failed: ${error.code}`;
  }
});
// 64 messages fill the rate budget; each call past it is a violation, and the 8th ends the mount.
button("flood", "Flood", () => {
  for (let index = 0; index < 80; index += 1) t3View.call("echo", { index }).catch(() => {});
  result.textContent = "flooded";
});
button("navigate", "Navigate away", () => {
  location.href = "https://example.com/";
});
button("blank", "Blank", () => {
  location.href = "about:blank";
});
document.body.append(result);

t3View.ready.then((view) => {
  status.textContent = `Connected: ${view.title} (${view.pluginId}/${view.viewId})`;
});
