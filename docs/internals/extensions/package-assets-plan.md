# Declared package assets: frozen implementation plan

Status: implemented in the integration worktree and proven through the installed web path; not shipped. See package-assets-evidence.md for exact acceptance and limits.
Baseline: 8406808225bb8a8ddf730d0c1d868fc59bd23c29 on lxso2.
Acceptance spine: saphid/personal-ops#128.

## Problem and boundary

An installed renderer cannot load its own binary assets. Ghostty currently imports private Vite URLs: core WASM 630,932 bytes, PTY trampoline 112 bytes, font 1,177,576 bytes. Adding wrappers does not solve this. This slice supplies portable immutable assets; it does not add terminal control, renderer extraction, complete panel parity, or orchestration operations.

## Package contract

Introduce format 4, extending format 3 with required assets array (empty allowed). Preserve formats 1/2/3 accepted keys and byte-for-byte hash semantics. Older validators must reject 4; new clients must negotiate advertised supportedPackageFormats before loading it. Format 4 supports existing format-3 APIs/streams; do not leave format===3 switches excluding it.

Each asset declaration has exactly path, byteLength, sha256, mediaType. Path is package-relative ASCII segments using existing entry segment rules, maximum 240 characters; no empty/dot/dot-dot/absolute/backslash segments. Paths are unique, cannot equal manifest/client/server entries, and no declared file may be a parent directory of another declared file. Limit 32 assets, 4 MiB each, 8 MiB aggregate. byteLength is nonnegative safe integer (empty assets permitted), sha256 exactly 64 lowercase hex. Initial mediaType allowlist: application/wasm, application/octet-stream, font/woff2. HTML/JavaScript/CSS/SVG are outside this first asset contract; bundled executable ESM remains an entry. Code plus manifest retain the existing 1 MiB cap; manifest 64 KiB cap remains.

The ordinary sorted, length-framed manifest/client/server digest remains the installation hash. For format 4 the manifest itself commits every asset path, size, type and SHA-256. Therefore changing declared asset bytes requires changing their digest and installation hash. Do not hash asset bytes twice into a second identity and do not change legacy hash calculation.

## Verification and storage

Separate metadata/code reading from a complete install snapshot by distinct types/functions. A complete readPackage verifies every declared asset size/digest, includes their bytes in its file map, and is required for install/update/store and full activation checks. An internal metadata reader hashes and verifies only existing code+manifest and returns no purported complete snapshot. storePackage must accept only a complete snapshot; never persist a partial file map.

Normal tool/API integrity checks use metadata/code verification, avoiding repeated reads of up to 8 MiB of assets on every invocation. readClient performs a full asset verification before returning executable client code; enable/rollback perform full verification. The server-side package worker does not gain a filesystem asset API in this slice. Asset reads verify metadata identity and the selected asset bytes each time. Unrequested assets are not continuously rehashed: host-owned storage is immutable by convention, and any changed asset is rejected before delivery. Preserve O_NOFOLLOW, regular-file, bounded-read, realpath protections; cover nested symlinks/path collisions with tests. Current path-based ancestor TOCTOU protections must not be described as stronger than they are.

Runtime readAsset(id, expectedContentHash, path, signal) returns verified bytes and declared metadata only for a current, enabled, dependency-available installation. Check identity/liveness/cancellation before and after awaits. Updating, removing, disabling, dependency invalidation, stale hash, unknown path, corruption, or cancellation cannot deliver a successful stale result. Bound concurrent runtime asset reads to 16 overall and 4 per installation, reject excess immediately, release counters in finally. No unbounded cache or request queue. Preserve rollback bytes using existing previous-revision retention and prune rules.

## Public client and HTTP boundary

ClientHost gains readAsset(path, signal), bound by the host to its environment, plugin id and installation hash, returning { bytes: Uint8Array, mediaType: string, sha256: string }. The plugin cannot supply another owner/hash/origin. Availability is negotiated by format 4. Existing hosts for legacy embedded extensions may omit this optional method; a format-4 installed host must supply it.

No server URLs or bearer tokens enter the plugin. The installed controller combines caller and installation lifetime signals and rejects results after refresh/disposal/dependency invalidation. Returned bytes are ordinary package data, not a revocable authority or resource lease; plugins own any derived object URLs and must revoke them on surface disposal. Static assets use the same authenticated read authority as client code, never terminal-operate authority.

Use a typed POST /api/extensions/asset with { id, expectedContentHash, path } and raw binary success, not base64 JSON or many API calls. Fixed response content type application/octet-stream; nosniff and no-store. SDK loader obtains declared mediaType/digest from the captured validated manifest and checks returned size/digest before delivery. Route through existing executeAuthenticatedEnvironmentHttpRequest and its prepared connection, refreshed bearer/DPoP credentials, exact method+URL binding, cancellation and timeouts. No new global fetch credential scheme or baked origin. Server endpoint revalidates authenticated session read authority before sending the bounded response. Detailed transport integration must use actual vendored Effect API signatures, with focused cookie/bearer/DPoP tests; no invented helpers.

## Slices and evidence

1. SDK format/asset validation plus runtime immutable storage and readAsset lifecycle. Independent packaged consumer validates published declarations. Legacy format hashes/tests unchanged. No public host advertises 4 before its full delivery path exists.
2. Typed authenticated binary endpoint, connection-aware client and installed controller. Scope, stale delivery, cancellation, conflicts, bounds and exact bytes tested. All applicable contract consumers typechecked; React Native/SwiftUI have no installed renderer implementation and must be documented as unsupported.
3. Independently packaged renderer-asset example loads a declared WASM through ClientHost only. Install, reload/restart, disable/update/rollback/uninstall, unknown/traversal assets and authenticated denial proven against retained lxso2 server. Existing installed Files, Terminal metadata/output and root-authority proofs preserved and rerun when integration changes.
4. Separate future native Terminal renderer extraction and PTY lifecycle/input/output contract. Asset example success alone is not terminal parity.

All source/tests/evidence on lxso2. Builder and monitor record contract gaps and process errors independently. Keep exact exit statuses, source hashes, proof receipts and measured transfer/first-load cost. Real relay/tunnel and V2 execution remain unproven until exercised. Original quota floor was 40%. On 2026-09-10 Alex authorized another 10%; the current floor is 30%. Stop parent and workers at that floor and retain incomplete work honestly.
