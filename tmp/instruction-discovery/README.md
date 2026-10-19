# Instruction and skill discovery experiment

The optimized search matches the independent GPT-5.6 Luna inventories exactly on this repository: **716 starting documents and 4,782 local reference candidates**, with no missing or extra paths. This is file-set equality, not just equal counts.

The starting documents comprise 188 AGENTS.md/CLAUDE.md files and 528 SKILL.md files. Discovery includes case variants and AGENTS/CLAUDE dot variants such as AGENTS.override.md and CLAUDE.local.md. There were no variant names in the measured corpus.

## Run it

From the repository root:

```sh
node tmp/instruction-discovery/discover.mjs
python3 tmp/instruction-discovery/verify_results.py
node tmp/instruction-discovery/check_discovery.mjs
```

The prototype uses Node, ripgrep, and the repository's already installed `mdast-util-from-markdown` package. No package installation or product code change is needed. Run `seed_baseline.py` and `reference_baseline.py` to regenerate the independent inventories if the source tree changes. The saved comparison otherwise checks against this experiment's snapshot.

The filename command used by the prototype is:

```sh
rg --no-config --files --null --hidden --no-ignore \
  --iglob 'AGENTS.md' --iglob 'AGENTS.*.md' \
  --iglob 'CLAUDE.md' --iglob 'CLAUDE.*.md' \
  --iglob 'SKILL.md' -- .
```

`--null` separates paths with NUL bytes so spaces and newlines cannot split filenames. There is no entry limit, depth limit, or result truncation. `--no-config` prevents a personal ripgrep configuration from changing the result. `--hidden --no-ignore` includes hidden directories, ignored worktrees, vendored repositories, and dependencies.

## What the experiment measured

| Method                                        |          Starting documents | Observed time |
| --------------------------------------------- | --------------------------: | ------------: |
| Ordinary rg with the filename globs           |                           2 |       0.018 s |
| Add --hidden                                  |                          16 |       0.059 s |
| Add --no-ignore                               |                         716 |       6.385 s |
| Same exhaustive rg, one thread                |                         716 |      30.873 s |
| Independent Lunar Python filesystem walk      |                         716 |      31.627 s |
| Final rg filename pass                        |                         716 |       5.944 s |
| Final filename pass plus recursive references | 4,782 total candidate files |       9.139 s |

These are observations from one session, with filesystem cache effects and concurrent work. They are not controlled cold-cache benchmark averages.

The exhaustive walk visited 382,095 directories and 3,617,982 regular files, with zero traversal errors. It recorded 96,410 directory symlinks without following them. A separate realpath audit found zero directory symlink targets outside the scanned root. All their target directories were already in the physical tree. Symlink aliases are not separate starting documents in this inventory.

## How reference discovery works

1. Start with the filename inventory. Do not require a particular sentence or frontmatter shape for a starting document to qualify.
2. Parse Markdown links, images, and reference definitions. Extract path candidates from inline code, commands, @imports, and prose with a Unicode-aware path regex.
3. Resolve candidates from the containing document, nearby package roots, and the containing checkout. Record competing matches as ambiguous. Keep the source document, reference spelling, and location for every resolved edge.
4. Queue newly reached Markdown, MDX, text, and RST documents. Record scripts, configuration files, and assets as leaves. Do not execute scripts or crawl their source import graphs.
5. Cache parsed identical contents, while resolving each document from its own location. Deduplicate canonical document paths to terminate reference cycles.

Markdown links use the installed Markdown parser because escaped characters, reference definitions, spaces, and balanced parentheses affect where a target ends. The regex still does the broad path extraction from code and prose.

I also tested this rg content prefilter on batches of discovered documents:

```sh
rg --no-config --files-with-matches --null --text --multiline \
  -e '[`@/]|\]\s*[:(]|\.[[:alnum:]_-]+' -- FILES...
```

It preserved the exact file set, but skipped only 17 documents and increased the reference pass from 2.56 to 3.73 seconds. It is available as `node tmp/instruction-discovery/discover.mjs . --prefilter`, but is disabled by default. Filename filtering did the useful reduction.

## Differences found and corrected

The independent reference pass initially missed bare filenames, dotfiles, and references rooted in vendored packages. Comparing the actual path sets exposed them. Examples included `CONTRIBUTING.md`, `.env.example`, `.patterns/effect.md`, and a skill's `scripts/extract-example.mjs`. The baseline also initially treated `/dev/null` as a file; both final inventories exclude special devices.

The final independent reference walker and optimized implementation agree on all 4,782 candidate paths. Their parsers remain different: the baseline uses regex extraction and Python path resolution; the optimized implementation uses a Markdown syntax tree plus regex path extraction and JavaScript path resolution.

## Edge cases and limits

- Fixtures pass for hidden/ignored paths, case variants, local/override names, backup exclusion, UTF-8 BOM, CRLF, UTF-16 with BOM, @imports, reference links, spaces, parentheses, percent-encoded newlines, Unicode, line suffixes, command paths, extensionless references, recursive links, assets, missing files, remote URLs, and cycles.
- A code example can mention a hypothetical file that coincidentally exists. These are reference candidates, not a claim that every file is required agent context. Ambiguity is retained in the output.
- Literal paths can resolve differently from a document, a package, or a checkout. The prototype records alternatives and selects the closest matching context. Runtime-specific import precedence may need different rules in a product implementation.
- Directory mentions are recorded without treating every descendant as a referenced file. Globs, placeholders, and shell interpolation are recorded as dynamic. The prototype does not execute shell expressions to resolve them.
- Remote URLs are not fetched. Scripts and assets are leaves. Arbitrary natural-language pointers, such as 'read the testing guide' without a path, need a semantic resolver or human interpretation.
- A new external directory symlink would require an explicit decision about scanning its target. The current corpus has none. Cyclic references terminate through canonical path tracking.
- UTF-8 and BOM-marked UTF-16 document contents are handled. Arbitrary legacy encodings and non-UTF-8 filename bytes have not been validated.
- Search errors are failures, not empty results. This is a live filesystem walk, not a transactional filesystem snapshot; concurrent changes can require another comparison.

## Evidence

- `instruction-baseline.json` and `seed_baseline.py`: independent exhaustive filesystem inventory.
- `reference-baseline.json` and `reference_baseline.py`: independent local reference inventory.
- `seed-searches.json` and `benchmark_seeds.py`: command variants, full path sets, and timings.
- `fast-discovery.json` and `discover.mjs`: final optimized result and implementation.
- `verification.json` and `verify_results.py`: exact seed and reference set comparison.
- `fixture-results.json` and `check_discovery.mjs`: focused edge-case checks.
- `external-symlink-targets.json`: empty external-target set from the symlink audit.
- `reference-prefilter-comparison.json`: equal-result content prefilter experiment.
