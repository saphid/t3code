import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import {
  appendPreviewAnnotationPrompt,
  buildPreviewAnnotationPrompt,
  capturePreviewAnnotationScreenshot,
  extractTrailingPreviewAnnotation,
} from "./previewAnnotation.ts";

const annotation = {
  id: "annotation_1",
  pageUrl: "http://localhost:3000",
  pageTitle: "Example",
  comment: "Make these cards feel related.",
  elements: [],
  regions: [{ id: "region_1", rect: { x: 10, y: 20, width: 100, height: 80 } }],
  strokes: [
    {
      id: "stroke_1",
      color: "#7c3aed",
      width: 4,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
      bounds: { x: 6, y: 6, width: 18, height: 18 },
    },
  ],
  styleChanges: [
    {
      targetId: "element_1",
      selector: ".card",
      property: "border-radius",
      previousValue: "4px",
      value: "16px",
    },
  ],
  screenshot: {
    dataUrl: "data:image/png;base64,AA==",
    width: 100,
    height: 80,
    cropRect: { x: 10, y: 20, width: 100, height: 80 },
  },
  createdAt: "2026-06-11T00:00:00.000Z",
};

const elementAnnotation = {
  ...annotation,
  elements: [
    {
      id: "element_1",
      rect: { x: 1, y: 2, width: 3, height: 4 },
      element: {
        pageUrl: "http://localhost:3000/",
        pageTitle: "Example",
        tagName: "BUTTON",
        selector: ".card > button",
        htmlPreview: "<button>Save</button>",
        componentName: "SaveButton",
        source: {
          functionName: "App",
          fileName: "src/App.tsx",
          lineNumber: 42,
          columnNumber: 7,
        },
        stack: [],
        styles: "border-radius: 4px;",
        pickedAt: "2026-06-11T00:00:00.000Z",
      },
    },
  ],
};

NodeTest.describe("buildPreviewAnnotationPrompt", () => {
  NodeTest.it("describes regions, drawings, styles, and screenshot context", () => {
    const result = buildPreviewAnnotationPrompt(annotation);
    NodeAssert.match(result, /^<preview_annotation>\n/);
    NodeAssert.match(result, /\n<\/preview_annotation>$/);
    NodeAssert.ok(result.includes("Id: annotation_1"));
    NodeAssert.ok(result.includes("Page: Example"));
    NodeAssert.ok(result.includes("Make these cards feel related."));
    NodeAssert.ok(result.includes("1 marked region"));
    NodeAssert.ok(result.includes("1 drawing"));
    NodeAssert.ok(result.includes("- border-radius: 4px → 16px"));
    NodeAssert.ok(result.includes("attached screenshot"));
  });

  NodeTest.it("emits the element_context block for picked elements", () => {
    const result = buildPreviewAnnotationPrompt(elementAnnotation);
    NodeAssert.ok(result.includes("Targets: 1 selected element, 1 marked region, 1 drawing."));
    NodeAssert.ok(result.includes("<element_context>"));
    NodeAssert.ok(result.includes("- <SaveButton> (App.tsx:42):"));
    NodeAssert.ok(result.includes("selector: .card > button"));
    NodeAssert.ok(result.includes("source: src/App.tsx:42:7"));
    NodeAssert.ok(result.includes("<button>Save</button>"));
  });

  NodeTest.it("falls back to the page url, then a bare title", () => {
    NodeAssert.ok(
      buildPreviewAnnotationPrompt({ ...annotation, pageTitle: null }).includes(
        "Page: http://localhost:3000",
      ),
    );
    NodeAssert.ok(
      buildPreviewAnnotationPrompt({ ...annotation, pageTitle: null, pageUrl: " " }).includes(
        "Page: Preview",
      ),
    );
  });
});

NodeTest.describe("appendPreviewAnnotationPrompt", () => {
  NodeTest.it("appends to an existing composer prompt", () => {
    NodeAssert.ok(
      appendPreviewAnnotationPrompt("Fix this", annotation).startsWith(
        "Fix this\n\n<preview_annotation>",
      ),
    );
  });

  NodeTest.it("stands alone on an empty prompt", () => {
    NodeAssert.ok(
      appendPreviewAnnotationPrompt("   ", annotation).startsWith("<preview_annotation>"),
    );
  });
});

NodeTest.describe("extractTrailingPreviewAnnotation", () => {
  NodeTest.it("extracts annotation presentation from a sent prompt", () => {
    const result = extractTrailingPreviewAnnotation(
      appendPreviewAnnotationPrompt("Fix this", annotation),
    );
    NodeAssert.equal(result.promptText, "Fix this");
    NodeAssert.equal(result.annotation?.id, "annotation_1");
    NodeAssert.equal(result.annotation?.title, "Example");
    NodeAssert.equal(result.annotation?.targetSummary, "1 marked region, 1 drawing.");
    NodeAssert.equal(result.annotation?.hasScreenshot, true);
    NodeAssert.deepEqual(result.annotation?.styleChanges, ["border-radius: 4px → 16px"]);
  });

  NodeTest.it("extracts multiple trailing annotations one at a time", () => {
    const first = appendPreviewAnnotationPrompt("Fix this", annotation);
    const secondAnnotation = { ...annotation, id: "annotation_2", pageTitle: "Details" };
    const second = appendPreviewAnnotationPrompt(first, secondAnnotation);
    const extractedSecond = extractTrailingPreviewAnnotation(second);
    const extractedFirst = extractTrailingPreviewAnnotation(extractedSecond.promptText);
    NodeAssert.equal(extractedSecond.annotation?.id, "annotation_2");
    NodeAssert.equal(extractedFirst.annotation?.id, "annotation_1");
    NodeAssert.equal(extractedFirst.promptText, "Fix this");
  });

  NodeTest.it("returns the prompt untouched when no block trails", () => {
    NodeAssert.deepEqual(extractTrailingPreviewAnnotation("plain text"), {
      promptText: "plain text",
      annotation: null,
    });
  });
});

NodeTest.describe("capturePreviewAnnotationScreenshot", () => {
  NodeTest.it("returns the crop when the fetch resolves", async () => {
    const capture = await capturePreviewAnnotationScreenshot(annotation);
    NodeAssert.equal(capture.status, "captured");
    if (capture.status === "captured") {
      NodeAssert.equal(capture.file.name, "preview-annotation-annotation_1.png");
      NodeAssert.equal(capture.file.type, "image/png");
    }
  });

  NodeTest.it("reports none when the annotation carries no crop", async () => {
    const capture = await capturePreviewAnnotationScreenshot({ ...annotation, screenshot: null });
    NodeAssert.deepEqual(capture, { status: "none" });
  });

  NodeTest.it("fails instead of hanging when the crop never arrives", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => new Promise(() => {});
    try {
      const capture = await capturePreviewAnnotationScreenshot(annotation, 50);
      NodeAssert.deepEqual(capture, { status: "failed" });
    } finally {
      globalThis.fetch = original;
    }
  });

  NodeTest.it("fails when the crop fetch throws", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("data url unreadable");
    };
    try {
      const capture = await capturePreviewAnnotationScreenshot(annotation);
      NodeAssert.deepEqual(capture, { status: "failed" });
    } finally {
      globalThis.fetch = original;
    }
  });
});
