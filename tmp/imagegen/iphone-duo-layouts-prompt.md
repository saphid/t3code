Use the imagegen skill and its built-in image_gen tool. Generate exactly five separate polished UI mockup images, making one image_gen call per concept. This is preview and design exploration for the current T3 Code repository. Save every final image in /Users/aus-m5p-as/projects/t3code-contrib/output/imagegen/ with these exact filenames:

1. t3code-iphone-duo-01-command-center.png
2. t3code-iphone-duo-02-conversation-artifact.png
3. t3code-iphone-duo-03-spatial-cards.png
4. t3code-iphone-duo-04-agent-timeline.png
5. t3code-iphone-duo-05-focus-drawer.png

The attached image is a reference image for T3 Code's visual language. Preserve its near-black #0a0a0a canvas, #111111 and #141414 raised surfaces, restrained #191919 borders, compact white and zinc typography, blue primary action, small provider and status color accents, rounded composer, project and thread hierarchy, changed-file presentation, and quiet professional density. This is T3 Code on iPhone Duo, not a generic coding app. Use the exact product name "T3 Code" when a product label is visible. Do not reproduce the desktop layout literally.

Hardware and composition facts from Apple's iPhone Duo technical specifications:

- Open device is a landscape book fold, 164.6 mm wide by 117.8 mm high.
- Inner display is a 7.6-inch folding OLED, 1878 by 2670 pixels, with rounded outer corners and a subtle vertical central fold or hinge seam.
- Closed device is 84.1 mm wide by 117.8 mm high and uses a 5.4-inch outer display.
- Treat the open inner display as a compact, near-square tablet with two usable regions. Do not depict two unrelated phones or a Surface Duo with a thick physical gap.
- Keep dense text, primary controls, the composer, and tap targets away from the central fold. It is fine for quiet backgrounds and separators to cross it.
- Show the open inner display straight-on in a premium black titanium device mockup. The UI itself must occupy almost the full image and remain readable. No hands, desk scene, accessories, marketing headline, floating annotations, or extra phones.

Shared user stories:

- A user opens the Duo to supervise several active agents without losing the current conversation.
- A user reads an agent response on one half while reviewing changed files, terminal output, or a live preview on the other.
- A user switches projects and threads with one thumb, then resumes typing without a modal detour.
- A user catches blocked, waiting, failed, and completed work at a glance.
- A user folds to the outer display and continues the same thread in a focused single-column view.
- Cross-fold actions only appear when content naturally belongs in separate panes.

Create these five concepts. Each output must be a different information architecture, not a recolor.

Concept 1, Command Center
Use case: ui-mockup
Primary story: supervise several active agents, then jump into one conversation.
Layout: a narrow left region contains compact project groups and thread rows with status dots, time, and tiny progress summaries. The wider right region contains the selected conversation, a short agent activity strip, latest response, changed-files card, and bottom composer. Put the fold between navigation and conversation. Make hierarchy instantly scannable and keep the selected thread obvious.
Visible text may include: "T3 Code", "Projects", "Active", "t3code", "iPhone Duo layout", "Working", "Changed files", "Ask for follow-up changes".

Concept 2, Conversation plus Artifact
Use case: ui-mockup
Primary story: read the agent response while reviewing its work.
Layout: the left half is a focused chat stream with concise user and agent messages and a docked composer. The right half is a contextual workbench with tabs "Diff", "Terminal", and "Preview". Show a clean code diff with green additions and restrained red deletions. Put the fold between chat and workbench. Add a small top switcher for project and thread, not a persistent sidebar.
Visible text may include: "T3 Code", "iPhone Duo layout", "Diff", "Terminal", "Preview", "3 files changed", "Ask for follow-up changes".

Concept 3, Spatial Cards
Use case: ui-mockup
Primary story: scan parallel work and open the task that needs attention.
Layout: a calm two-column canvas of large task cards aligned to the fold, with no permanent sidebar. Each card represents a thread and shows project, task title, provider, status, elapsed time, last agent sentence, and a tiny artifact preview. One card is expanded into a conversation sheet that stays on one side. Use generous spacing without wasting the compact screen. Navigation is a slim rail along the far left edge.
Visible text may include: "T3 Code", "Today", "Needs you", "Working", "Completed", "Review mobile layout", "Fix pairing flow".

Concept 4, Agent Timeline
Use case: ui-mockup
Primary story: understand what multiple agents did, what is blocked, and what finished.
Layout: a chronological activity timeline runs vertically near the fold, with events branching into each half. Left-side events summarize projects and parallel threads. Right-side events show the selected agent's receipts, tool activity, changed files, and checkpoint. A persistent compact composer sits only in the lower-right region. Make status changes easy to read without turning the screen into a monitoring dashboard.
Visible text may include: "T3 Code", "Now", "Working", "Waiting for approval", "Checkpoint saved", "4 files changed", "Continue".

Concept 5, Focus plus Drawer
Use case: ui-mockup
Primary story: stay immersed in one conversation while switching context with one thumb.
Layout: the conversation occupies nearly the full inner display with comfortable reading width centered across the two regions, but no paragraph or control crosses the fold. A layered project and thread drawer is partially revealed from the left edge, and a compact artifact drawer is partially revealed from the right edge. The bottom composer becomes two coordinated regions, input on the left side and model, permission, attachment, and send controls on the right, separated safely around the fold. It should feel focused and mobile-native.
Visible text may include: "T3 Code", "Codebase overview", "Changed files", "Claude Opus 4.5", "Full access", "Ask for follow-up changes".

Shared quality bar:

- High-fidelity production UI mockup, crisp 2D interface, straight-on device presentation.
- Render at landscape 1536 by 1024 or the closest supported landscape size.
- Respect iOS safe areas, rounded corners, readable type, and minimum comfortable touch targets.
- Keep the design visually plausible for React Native and consistent with T3 Code.
- No glassmorphism haze, neon cyberpunk, gradients, fake reflections over the UI, decorative wallpaper, exaggerated shadows, skeuomorphic keys, illegible microtext, lorem ipsum, watermark, or logos from other products.
- Avoid accidental duplicate controls, mangled text, and content placed on the fold.

After generation, inspect all five images. If an image is missing the open book-fold device, ignores T3 Code styling, has a thick physical gap, or duplicates another concept's layout, retry only that image with a targeted correction. Return a concise list of saved paths and a one-sentence assessment of each concept.
