# PR media — swift-ios text & code size controls

Raw `xcrun simctl io screenshot` captures from the canonical proof simulator
(`B0B16E05-D2DE-4243-B27B-6837D50FDFE6`), taken against the rebased branch head
(installed dylib sha256 `59a33f697bc6faaccd8665cb5a887981e8da74dcfbe9cff220a5c677408fb23b`,
hash-verified against the build product immediately before every capture pass).

Every claimed screen appears in both light and dark appearance.

| file | appearance | text size | code size |
|---|---|---|---|
| `A-light-default-*` | light | Default | Default |
| `A-dark-default-*` | dark | Default | Default |
| `B-light-t3c3-*` | light | Largest | Largest |
| `B-dark-t3c3-*` | dark | Largest | Largest |
| `S-light-t3c3-settings.png` | light | Largest | Largest |
| `S-dark-t3c3-settings.png` | dark | Largest | Largest |

Backed by a real local T3 server, a real git fixture repository with an
uncommitted diff, and a real agent turn — no mocks or fixtures in the client.
