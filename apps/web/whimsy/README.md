# Whimsy atlas workbench

Open `/whimsy/index.html` on this worktree's shared development origin. The
page has 51 sourced historical examples in ten categories, 24 additional T3
proposals, and four implemented component studies with cropped Electron recordings.
Every example has an inline GIF playing by default. A system reduced-motion
preference starts with still frames and an explicit Play all override. Authentic recordings have
source credits; animated diagrams and proposed treatments are explicitly labeled. It is a curated survey, not an exhaustive inventory of
everything Apple has shipped.

This directory and `../whimsy-fixture.html` are development entries. They are
not in `public/` or the default production build inputs. The fixture imports
the proposed shared renderer components and CSS. It uses synthetic state;
its labels and recordings must not be presented as end-to-end backend tests.

## Run

From the repository root, follow the `test-t3-app` skill. The retained preview
was launched with `vp run dev --share`, worktree-local `.t3` state,
`T3CODE_BUNDLED_DEV=0` and `NODE_OPTIONS=--dns-result-order=ipv4first`.
The DNS option resolves this Mac's IPv6/IPv4 loopback mismatch; disabling the
experimental bundled development mode avoided a Rolldown panic. Use the
actual origin reported by the runner; ports can shift.

The private preview's downloaded reference media is ignored by git. Original
URLs and conversion details are in [media/SOURCES.md](./media/SOURCES.md).
The T3 captures are available on the public
[evidence branch](https://github.com/saphid/t3code/tree/whimsy/electron-evidence),
with exact feature commits, provenance and file hashes. Copy its PNG, GIF and
MP4 files into `media/` to reproduce the recorded examples in another checkout.
That branch also carries the original `apple-N` diagram pairs, the 24
`idea-EX-N` proposal pairs, and a desktop recording of the expanded gallery.
Downloaded publisher footage remains a local attributed reference.

## Review inputs

- [Agent whimsy guide](../../../docs/internals/whimsy-guide.md)
- [Selected Apple references](../../../docs/internals/whimsy-references.md)
- [Source review and eight ranked opportunities](../../../docs/internals/whimsy-review.md)
- [First implementation and verification record](../../../docs/internals/whimsy-electron-validation.md)

The feature PRs are independent patches against the reviewed baseline:
[project marks](https://github.com/saphid/t3code/pull/53),
[connection clasp](https://github.com/saphid/t3code/pull/54),
[completion tick](https://github.com/saphid/t3code/pull/55), and
[calm spectrum](https://github.com/saphid/t3code/pull/56).

`evidence.json` supplies the implemented studies’ image, GIF, video and PR links.
`opportunities.json` supplies the 24 proposals and their agent briefs;
`illustrations.json` maps every historical entry to a recording or a labeled
diagram. GIFs play inline by default. Pause all swaps them for still frames;
hiding the page also pauses them, and returning resumes unless manually paused.
The gallery’s repeating demonstrations do not authorize idle animation in the app.

The expanded implementation handoff is [whimsy-opportunities.md](../../../docs/internals/whimsy-opportunities.md).
