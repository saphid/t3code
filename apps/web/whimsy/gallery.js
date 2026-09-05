const mediaTimers = new Map();
function stopMedia(container) {
  const image = container.querySelector("img");
  image.src = `./media/${container.dataset.media}.png`;
  const button = container.querySelector("button");
  button.textContent = container.dataset.playLabel || "▶ Play Apple GIF";
  button.setAttribute("aria-pressed", "false");
  clearTimeout(mediaTimers.get(container));
  mediaTimers.delete(container);
}
function wireMedia(container) {
  const button = container.querySelector("button");
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    if (mediaTimers.has(container)) return stopMedia(container);
    for (const other of mediaTimers.keys()) stopMedia(other);
    container.querySelector("img").src = `./media/${container.dataset.media}.gif`;
    button.textContent = "■ Stop preview";
    button.setAttribute("aria-pressed", "true");
    mediaTimers.set(
      container,
      setTimeout(() => stopMedia(container), 8000),
    );
  });
}
for (const container of document.querySelectorAll("[data-media]")) wireMedia(container);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) for (const container of mediaTimers.keys()) stopMedia(container);
});

const catalogue = document.querySelector("#catalogue");
const search = document.querySelector("#search");
const category = document.querySelector("#category");
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
try {
  const response = await fetch("./catalogue.json");
  if (!response.ok) throw new Error("Catalogue unavailable");
  const entries = await response.json();
  for (const name of [...new Set(entries.map((entry) => entry.category))].sort()) {
    const option = element("option", name);
    option.value = name;
    category.append(option);
  }
  const render = () => {
    const query = search.value.trim().toLowerCase();
    const matches = entries.filter(
      (entry) =>
        (!category.value || entry.category === category.value) &&
        `${entry.title} ${entry.era} ${entry.category} ${entry.behavior} ${entry.lesson}`
          .toLowerCase()
          .includes(query),
    );
    catalogue.replaceChildren(
      ...matches.map((entry) => {
        const card = element("article", "", "entry");
        const link = element("a", "Read the source ↗");
        link.href = entry.source;
        card.append(
          element("p", `${entry.era} / ${entry.category}`, "meta"),
          element("h3", entry.title),
          element("p", entry.behavior),
          element("p", entry.lesson, "lesson"),
          link,
        );
        return card;
      }),
    );
    if (!matches.length)
      catalogue.append(element("p", "No matches. Try another detail or category."));
    document.querySelector("#count").textContent =
      `${matches.length} of ${entries.length} examples`;
  };
  search.addEventListener("input", render);
  category.addEventListener("change", render);
  render();
} catch {
  catalogue.replaceChildren(element("p", "The catalogue could not load. Reload to try again."));
}

// Capture manifest is generated after verification; missing evidence is never
// replaced with a mock recording or presented as a completed runtime check.
try {
  const response = await fetch("./evidence.json");
  if (response.ok) {
    const manifest = await response.json();
    for (const [name, evidence] of Object.entries(manifest)) {
      const target = document.querySelector(`[data-evidence="${name}"]`);
      if (!target) continue;
      for (const [label, url] of Object.entries(evidence)) {
        const link = element("a", label);
        link.href = url;
        target.append(link);
      }
      const details = element("details", "", "capture-details");
      details.append(element("summary", "Replay the Electron component recording"));
      const media = element("div", "", "media");
      media.dataset.media = `${name}-after`;
      media.dataset.playLabel = "▶ Play T3 GIF";
      const poster = document.createElement("img");
      poster.src = `./media/${name}-after.png`;
      poster.alt = `${name} component fixture captured in Electron with synthetic data`;
      const play = element("button", "▶ Play T3 GIF", "play");
      play.type = "button";
      media.append(poster, play);
      details.append(media);
      target.append(details);
      wireMedia(media);
    }
  }
} catch {
  /* Live fixtures remain available when captures are not installed. */
}
