# Focus Shelf

Focus Shelf is a local webpage for a personal issue snapshot, browser-local memos, archive flags and manual PR status. It has no account login or external-service client. Opening, editing or reloading the page reads local files only. Refresh from Linear/GitHub is an explicit authorized Codex workflow.

## Setup

Use Node 22 or later. There are no dependencies to install. Set `FOCUS_SHELF_HOME` to an absolute directory outside this repository, then run `npm start`. Open `http://localhost:8770` in a current browser with Web Locks support. Keep this fixed origin to preserve browser-local overlays. If port 8770 is occupied, startup fails with `EADDRINUSE`; it never stops another service or switches ports.

```sh
export FOCUS_SHELF_HOME=/absolute/path/to/your-local-shelf
npm start
```

A missing config or snapshot produces a safe empty state. Choose one of the following setup paths and keep personal files outside the checkout.

### Demo home

For an offline demonstration, use a separate external demo home. Copy all three synthetic examples into it: `examples/config.example.json` as `config.json`, `examples/snapshot.example.json` as `linear-latest.json`, and `examples/catalog.example.json` as `catalog.json`. Keep their synthetic demo identity unchanged. No external capabilities or real account data are needed for the demo.

### Real home

For your own workflow, use a different external real home. Create only `config.json`: use the config example as a shape guide and set your own stable profile ID, authorized owner ID and workspace slug. Do not copy the demo snapshot or catalog into this home. Start the page in its empty state, then explicitly ask Codex for the first refresh through the authorized capabilities described below. The first real snapshot is produced from verified account evidence, rather than relabeling demo data.

Your `profileId`, `ownerId` and `workspaceSlug` form a stable browser storage namespace. Changing any identity opens a separate overlay store. Missing or changed identity fails closed.

Only one window per profile may write overlays. A second window displays read-only controls; close the writer and select “Try writer lock” to take over and load the latest saved overlays. Without Web Locks the page is read-only. Browser-local storage is tied to this browser and origin; clearing site storage removes those overlays. A storage failure is visibly reported and never acknowledged as saved.

Memo changes save when leaving the text field; Archive and manual PR status save immediately. PR keys include repository and number. A local report uses your current memo/archive/manual PR overlays and never sends anything. The shared starter intentionally does not include the unfinished saved-webpage experiment or any personal shortcut set.

## Manual snapshot refresh

Read [CODEX_SNAPSHOT.md](CODEX_SNAPSHOT.md) and the bundled [thin Skill](skills/focus-shelf/SKILL.md). Ask Codex explicitly to refresh through already authorized capabilities. Complete assigned plus followed coverage and relationship evidence are required; incomplete access preserves the existing snapshot. This starter neither connects to external services nor grants that authorization.

Codex needs an already authorized Linear connector/MCP that can read the configured owner's assigned issues, prior followed issue IDs, reciprocal relations and Sprint metadata in the configured workspace. For the first refresh there is no prior snapshot; subsequent refreshes must also retain the prior followed set. An active-only search, incomplete relation coverage or missing Sprint evidence cannot establish complete coverage. Without these capabilities, preserve the previous files, or keep a first real home empty, and report the missing evidence.

Optional PR/CI catalog enrichment needs an authorized GitHub connector/MCP or logged-in CLI able to read verified associated PR metadata and complete checks/status for the relevant repositories. Verify the issue association, repository, PR number, base branch, state and observed head before describing checks. Keep passed/failed/pending/skipped/neutral/unknown distinct. If optional GitHub evidence is unavailable, preserve the previous catalog; do not fabricate entries or treat missing/skipped checks as passed. A preserved catalog that no longer matches the new snapshot time will be omitted by the page.

Credentials stay in the authorized connector or logged-in CLI session; never write credentials into config, snapshots, catalog or browser overlays. Config contains identity and local presentation preferences only. The starter installs no connector and does not sign in to services.

```sh
node scripts/write-codex-snapshot.mjs /absolute/path/to/validated-input.json
```

The writer uses only `FOCUS_SHELF_HOME/config.json` and publishes only `FOCUS_SHELF_HOME/linear-latest.json`. It locks before reading the latest snapshot, rejects older or divergent same-time input, preserves previously followed IDs (including Done issues), and writes through an atomic temp-file rename. Exact repeats are idempotent. Catalog is optional and is omitted unless its owner/workspace/schema/time match the snapshot. Invalid data is never returned raw. No automatic migration or unfollow operation is included.

## Verification and sharing

Run `npm test` and `node scripts/validate-shareable.mjs`. The publication validator permits only the declared code/docs/synthetic examples/tests; `.git`, `work` and `node_modules` are excluded from publication. Do not share a raw working-directory archive or Git history containing local records. Share only the validator's allowlisted `files` list. Configuration, snapshots, catalog, browser overlays, credentials, private links and company identifiers must remain local.

Run `node scripts/validate-shareable.mjs --list` to print the exact sorted allowlisted publication files as JSON. Both validation modes are read-only; the command does not create an archive, copy files or publish remotely. Package only that list after validation, leaving excluded local state out.

For a local privacy check, optionally set `FOCUS_SHELF_DENYLIST_FILE` to an absolute external JSON file containing an array of private strings to reject. The validator reads it locally and never includes its bytes or path in the publication list. Keep real identities and company identifiers out of shared code and fixtures; bundled probes use synthetic markers only. Without this optional file, validation checks the file allowlist and generic credential patterns and does not claim personalized identity coverage.

The HTTP server binds localhost and accepts only the canonical `localhost:8770` Host; alternate loopback aliases are rejected to keep browser storage and writer locks on one origin. It rejects non-GET requests, traversal and symlinks and serves an explicit static allowlist. It has no cloud deployment, extension, calendar, Slack, Taskboard, OAuth or background synchronization feature. Remote repository creation, publication and real-data migration are separate actions.
