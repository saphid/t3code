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

// iOS: a frame inside the view can see the native message handlers. Each frame below posts a
// call straight to them; the patched host drops all of them, so the plugin sees none.
const nestedFrames = () => {
  const blank = document.createElement("iframe");
  const srcdoc = document.createElement("iframe");
  srcdoc.srcdoc = "<p>nested</p>";
  document.body.append(blank, srcdoc);
  return [blank, srcdoc];
};
const forge = (target, id) => {
  const handlers = target.webkit?.messageHandlers;
  if (!handlers) return "no handlers";
  const call = JSON.stringify({ _tag: "call", id, handler: "echo", input: { forged: id } });
  handlers.ReactNativeWebView?.postMessage(
    JSON.stringify({ type: "message", text: call, ports: 0 }),
  );
  handlers.ReactNativeWebView?.postMessage(JSON.stringify({ type: "host", restricted: true }));
  handlers.ReactNativeWebView?.postMessage(JSON.stringify({ type: "connected" }));
  handlers.ReactNativeHistoryShim?.postMessage("other");
  return "visible";
};
button("forge", "Forge", async () => {
  const [blank, srcdoc] = nestedFrames();
  await new Promise((resolve) => srcdoc.addEventListener("load", resolve, { once: true }));
  const seen = [
    forge(window, 1001),
    forge(blank.contentWindow, 1002),
    forge(srcdoc.contentWindow, 1003),
  ];
  const answer = await t3View.call("forged", null);
  result.textContent = `handlers: ${seen.join(", ")}; forged calls reached the plugin: ${answer.forged}`;
});
// Nested frames try to leave the view; the patched iOS host refuses every such navigation.
button("nested-navigate", "Nested navigate", () => {
  const frames = nestedFrames();
  for (const frame of frames) frame.contentWindow.location.href = "https://example.com/";
  setTimeout(() => {
    const states = frames.map((frame) => {
      try {
        return frame.contentWindow.location.href;
      } catch {
        return "navigated away";
      }
    });
    result.textContent = `nested frames: ${states.join(", ")}`;
  }, 2000);
});
document.body.append(result);

t3View.ready.then((view) => {
  status.textContent = `Connected: ${view.title} (${view.pluginId}/${view.viewId})`;
});
