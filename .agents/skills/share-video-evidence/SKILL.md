---
name: share-video-evidence
description: Share recorded video evidence so it is playable from the recipient's T3 client instead of stranded on the recording host. Use for recording or screen-recording work, demo videos, proof videos, walkthroughs, requests to show a process working, sharing a video in chat, returning or handing back an MP4, or any task whose completion evidence is a video artifact.
---

# Share Video Evidence

Treat delivery as part of producing the proof. A valid video on the agent's
filesystem is not a successful handoff.

## Delivery contract

1. Prefer a native T3 evidence or artifact attachment that plays inline. Use
   the product-supported attachment mechanism when the current harness exposes
   one, and confirm that the attachment appears as playable media when the
   interface reports that state.
2. If native attachment is unavailable, publish only the intended video through
   an existing authenticated endpoint or a Tailnet-only URL. The URL must open
   from the intended clients, including desktop Electron and Swift/iOS mobile
   when the request spans both surfaces.
3. Never hand back only an absolute local filesystem path or a T3 chat link to
   one. A local path may be included as supplementary provenance, but it is not
   delivery and is normally meaningless on another device.
4. Avoid public exposure. Use a public URL only with explicit authorization.
   Do not start an accidental broad file server: serve the exact file or a
   narrow read-only directory, and keep the listener loopback-bound behind the
   approved private proxy or otherwise access-controlled.

## Verify before handoff

- Inspect the source file as media and retain its byte size and SHA-256 when
  practical.
- Fetch the final URL with an authenticated `GET`, following redirects. Require
  a successful response, the correct `video/*` media type (normally
  `video/mp4` for an MP4), and the intended bytes. Compare the downloaded size
  and SHA-256 with the source when the endpoint is meant to serve the file
  unchanged. Do not rely on `HEAD` alone.
- Check byte-range playback support when the target client or video size makes
  seeking/streaming relevant.
- Open and play the result in the target client where practical. For a
  cross-surface T3 handoff, test both Electron and Swift/iOS when available.
  State any client that could not be tested; never imply playback was verified
  there.

## Own the serving lifecycle

Prefer an already managed private artifact service. If a temporary server is
necessary, record:

- the person, agent, service, or process that owns it;
- its bind boundary and access control;
- the exact artifact or narrow directory it serves;
- how long the URL is expected to remain live; and
- who will stop the server and remove the temporary copy, and when.

Do not promise a URL backed by a foreground process that will end with the
current tool call. Do not leave a broad or undocumented server running after
the promised window.

## Handoff format

Return the playable attachment or URL and state:

- access class: `Tailnet-only`, `authenticated/private`, `local`, or `public`;
- media verification: HTTP result, media type, byte count or hash comparison;
- client verification: which T3 client actually played it; and
- lifecycle: server owner, expected lifetime, and cleanup responsibility.

A `local` link is supplementary only and never satisfies the contract by
itself.

## Regression precedent

On 2026-08-09, the valid local MP4 at
`~/.t3/transfer-video-proof-20260809/artifacts/project-transfer-review-copy-verify-open-target.mp4`
could not be opened from a T3 chat filesystem link, while a Tailnet-only HTTP
URL worked. Preserve that distinction: local validity does not prove recipient
reachability.
