export function observedNodes(root, { text, itemPath } = {}) {
  const results = [];
  function visit(node, inSurface = false) {
    const attributes = Object.fromEntries(
      Array.from({ length: (node.attributes?.length ?? 0) / 2 }, (_, i) => [
        node.attributes[i * 2],
        node.attributes[i * 2 + 1],
      ]),
    );
    if (attributes["aria-hidden"] === "true" || ["STYLE", "SCRIPT"].includes(node.nodeName))
      return { text: "", matched: false };
    const scoped = inSurface || "data-right-panel-surface-content" in attributes;
    const children = [...(node.children ?? []), ...(node.shadowRoots ?? [])];
    const childResults = children.map((child) => visit(child, scoped));
    const content =
      node.nodeType === 3 ? (node.nodeValue ?? "") : childResults.map((item) => item.text).join("");
    const directMatch =
      scoped &&
      (itemPath !== undefined
        ? attributes["data-item-path"] === itemPath && attributes.role === "treeitem"
        : node.nodeType === 1 && content.includes(text));
    if (directMatch && !childResults.some((item) => item.matched) && node.backendNodeId)
      results.push({
        backendNodeId: node.backendNodeId,
        text: content,
        attributes,
        nodeName: node.nodeName,
      });
    return { text: content, matched: directMatch || childResults.some((item) => item.matched) };
  }
  visit(root);
  return results;
}
export async function observedText(page, cdp, query, { click = false, timeoutMs = 20000 } = {}) {
  const until = Date.now() + timeoutMs;
  let lastCount = 0;
  while (Date.now() < until) {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const nodes = observedNodes(root, query);
    lastCount = nodes.length;
    const visible = [];
    for (const node of nodes) {
      let objectId;
      try {
        objectId = (await cdp.send("DOM.resolveNode", { backendNodeId: node.backendNodeId })).object
          .objectId;
        const result = await cdp.send("Runtime.callFunctionOn", {
          objectId,
          returnByValue: true,
          functionDeclaration: function () {
            const box = this.getBoundingClientRect();
            let left = Math.max(0, box.left),
              right = Math.min(innerWidth, box.right);
            let top = Math.max(0, box.top),
              bottom = Math.min(innerHeight, box.bottom);
            for (let node = this; node; node = node.parentElement || node.getRootNode()?.host) {
              const style = getComputedStyle(node),
                rect = node.getBoundingClientRect();
              if (
                style.display === "none" ||
                style.visibility === "hidden" ||
                Number(style.opacity) === 0 ||
                node.getAttribute("aria-hidden") === "true"
              )
                return false;
              if (style.display === "contents") continue;
              if (style.overflowX !== "visible") {
                left = Math.max(left, rect.left);
                right = Math.min(right, rect.right);
              }
              if (style.overflowY !== "visible") {
                top = Math.max(top, rect.top);
                bottom = Math.min(bottom, rect.bottom);
              }
            }
            return right - left > 0.5 && bottom - top > 0.5;
          }.toString(),
        });
        if (result.result.value === true) visible.push(node);
      } catch {
        /* Virtualized nodes can be replaced; retry the observed document. */
      } finally {
        if (objectId) await cdp.send("Runtime.releaseObject", { objectId }).catch(() => {});
      }
    }
    if (visible.length) {
      if (visible.length !== 1) throw new Error("Ambiguous observed CDP target");
      const node = visible[0];
      if (click) {
        const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: node.backendNodeId });
        const q = model.content;
        await page.mouse.click((q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4);
      }
      return {
        text: query.text ?? null,
        itemPath: query.itemPath ?? null,
        matched: true,
        evidence: "actual scoped visible DOM including closed shadow roots",
      };
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  throw new Error(
    "CDP target not visibly observed: " + JSON.stringify(query) + "; candidates=" + lastCount,
  );
}
