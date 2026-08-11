# Host storage warnings

T3 Code monitors the free space on the computer that stores its server data. When space runs low,
connected web, desktop, React Native mobile, and SwiftUI mobile clients show a persistent warning.
The warning clears automatically after enough space is available again.

- **Low:** free space is at or below 10 GiB or 5% of the volume, whichever is larger, capped at 25% on small volumes.
- **Critically low:** free space is at or below 5 GiB or 1% of the volume, whichever is larger, capped at 10% on small volumes.

Free space on the host before the warning becomes critical. Thread history, messages, attachments,
logs, and checkpoints may all need room on that volume.
