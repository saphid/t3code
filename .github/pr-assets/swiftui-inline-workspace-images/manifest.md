# PR 7378 exact-head visual proof

- PR head: `60c3e1c56a7d0acb05d6d4fbd40d57fd8e70eadc`
- Simulator: `T3 SwiftUI Proof` (`B0B16E05-D2DE-4243-B27B-6837D50FDFE6`)
- Built and installed `T3Code.debug.dylib` SHA-256: `4cb9af09c6eaf3fdd38f0ae287eb34dcbfd728b6f63866b420e7b1ac81d42bfc`
- Fixture: a real Git workspace containing `out/render.png`, served by a disposable real T3 backend through the signed workspace-asset route.

## Visual comparison against the requirement

Both final frames show the same user message in light and dark appearances.

- `![Generated workspace grid](out/render.png)` renders the real six-colour workspace bitmap inline, with its white diagonal and dark border intact. It is neither raw Markdown nor alternative text.
- `![Malformed image](out/render.png garbage)` remains the full raw malformed Markdown text and does not load the local bitmap.
- `![Remote image](https://example.com/logo.png)` remains the alternative text `Remote image`; the remote URL is not fetched inline.
- The card, image border, labels, and fallback text remain legible in both appearances.

The assistant text below the card is incidental output from the disposable proof turn. It is not part of the feature claim.

`DISCARDED-transient-light-redraw-60c3e1c.png` was captured two seconds after switching from dark to light and caught the asynchronously decoded bitmap partway through a redraw. It is retained as discarded evidence and is not published. The final light capture was taken after an eight-second settle and displays the complete bitmap.
