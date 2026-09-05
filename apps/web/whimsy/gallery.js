const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let paused = reducedMotion.matches;
let motionOverridden = false;
const pauseButton = document.querySelector("#pause-all");
function syncMotion() {
  for (const img of document.querySelectorAll("img[data-animated]")) {
    const src = paused || document.hidden ? img.dataset.still : img.dataset.animated;
    if (img.getAttribute("src") !== src) img.src = src;
  }
  pauseButton.textContent = paused ? "Play all GIFs" : "Pause all GIFs";
  pauseButton.setAttribute("aria-pressed", String(paused));
}
pauseButton.addEventListener("click", () => {
  motionOverridden = true;
  paused = !paused;
  syncMotion();
});
reducedMotion.addEventListener("change", () => {
  if (!motionOverridden) paused = reducedMotion.matches;
  syncMotion();
});
document.addEventListener("visibilitychange", syncMotion);
syncMotion();
function wireImage(img, gif, poster) {
  img.dataset.animated = gif;
  img.dataset.still = poster;
  img.src = paused || document.hidden ? poster : gif;
}
for (const container of document.querySelectorAll("[data-media]")) {
  wireImage(
    container.querySelector("img"),
    `./media/${container.dataset.media}.gif`,
    `./media/${container.dataset.media}.png`,
  );
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function motionFigure(name, title, caption) {
  const figure = element("figure", "", "motion-figure");
  const img = document.createElement("img");
  img.alt = title;
  img.loading = "lazy";
  img.width = 640;
  img.height = 360;
  wireImage(img, `./media/${name}.gif`, `./media/${name}.png`);
  figure.append(img, element("figcaption", caption));
  return figure;
}
async function readJson(name) {
  const response = await fetch(`./${name}.json`);
  if (!response.ok) throw new Error(`${name} unavailable`);
  return response.json();
}
const catalogue = document.querySelector("#catalogue");
const search = document.querySelector("#search");
const category = document.querySelector("#category");
try {
  const [entries, illustrations] = await Promise.all([
    readJson("catalogue"),
    readJson("illustrations"),
  ]);
  for (const name of [...new Set(entries.map((entry) => entry.category))].sort()) {
    const option = element("option", name);
    option.value = name;
    category.append(option);
  }
  const render = () => {
    const query = search.value.trim().toLowerCase();
    const matches = entries
      .map((entry, index) => ({ ...entry, index }))
      .filter(
        (entry) =>
          (!category.value || entry.category === category.value) &&
          `${entry.title} ${entry.era} ${entry.category} ${entry.behavior} ${entry.lesson}`
            .toLowerCase()
            .includes(query),
      );
    catalogue.replaceChildren(
      ...matches.map((entry) => {
        const card = element("article", "", "entry");
        const media = illustrations[String(entry.index)];
        const link = element("a", "Read the source ↗");
        link.href = entry.source;
        card.append(
          element("p", `${entry.era} / ${entry.category}`, "meta"),
          element("h3", entry.title),
          motionFigure(media.name, `${entry.title}: ${entry.behavior}`, media.caption),
          element("p", entry.behavior),
          element("p", entry.lesson, "lesson"),
          link,
        );
        if (media.source) {
          const credit = element("a", "Recording source ↗", "recording-credit");
          credit.href = media.source;
          card.append(credit);
        }
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
try {
  const entries = await readJson("opportunities");
  const grid = document.querySelector("#opportunities-grid");
  const area = document.querySelector("#opportunity-area");
  for (const name of [...new Set(entries.map((entry) => entry.area))].sort()) {
    const option = element("option", name);
    option.value = name;
    area.append(option);
  }
  const render = () => {
    const matches = entries.filter((entry) => !area.value || entry.area === area.value);
    grid.replaceChildren(
      ...matches.map((entry) => {
        const card = element("article", "", "opportunity");
        card.append(
          element("p", `PROPOSED / ${entry.area}`, "meta"),
          element("h3", entry.title),
          motionFigure(
            `idea-${entry.id}`,
            entry.behavior,
            "Animated proposal · schematic, not implemented app footage",
          ),
          element("p", entry.behavior),
          element("p", `When: ${entry.trigger}`, "trigger"),
        );
        const details = element("details", "", "implementation-note");
        details.append(element("summary", "Agent brief & verification"));
        for (const [label, key] of [
          ["Settled state", "settled"],
          ["Failure & reversal", "failure"],
          ["Verify", "verification"],
          ["Apple lesson", "appleLesson"],
        ])
          details.append(element("p", `${label}: ${entry[key]}`));
        const source = element("a", "Source context ↗");
        source.href = `https://github.com/saphid/t3code/blob/5c659e068/${entry.source}`;
        details.append(source);
        card.append(details);
        return card;
      }),
    );
    document.querySelector("#opportunity-count").textContent =
      `${matches.length} new ideas + 4 implemented studies`;
  };
  area.addEventListener("change", render);
  render();
} catch {
  document
    .querySelector("#opportunities-grid")
    .append(element("p", "The opportunities could not load. Reload to try again."));
}
try {
  const manifest = await readJson("evidence");
  for (const [name, evidence] of Object.entries(manifest)) {
    const target = document.querySelector(`[data-evidence="${name}"]`);
    if (!target) continue;
    target.append(
      motionFigure(
        `${name}-after`,
        `${name} component fixture in Electron`,
        "Implemented component · recorded in Electron with synthetic state",
      ),
    );
    for (const [label, url] of Object.entries(evidence)) {
      const link = element("a", label);
      link.href = url;
      target.append(link);
    }
  }
} catch {
  /* The reference catalogue remains usable without PR evidence. */
}
