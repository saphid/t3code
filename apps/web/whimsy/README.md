# Whimsy atlas workbench

Open `/whimsy/index.html` on this worktree's shared development origin. The
page has 51 sourced historical examples in ten categories, three authentic
Apple GIF references, and four interactive T3 component studies with cropped
Electron recordings. It is a curated survey, not an exhaustive inventory of
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

`evidence.json` supplies their image, GIF, video and PR links. Inline GIF
previews start only on request and stop after eight seconds or when the page
is hidden. Direct GIF downloads retain their normal looping behavior.
