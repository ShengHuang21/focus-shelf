---
name: focus-shelf
description: Explicit local Focus Shelf manual refresh.
---

Use only when the user explicitly requests an authorized manual Focus Shelf refresh. This thin Skill does not grant external account access or publish anything remotely.

Required capability: an already authorized Linear connector/MCP that reads the configured owner's assigned issues, prior followed IDs, reciprocal relations and Sprint metadata in the configured workspace. A first real home has config only and no prior snapshot; do not copy demo snapshot/catalog data into it. Ask for an explicit first refresh and create data only from verified account evidence. If complete Linear coverage is unavailable, preserve the previous files or retain an empty first home and report the gap.

Optional catalog enrichment: an authorized GitHub connector/MCP or logged-in CLI that reads verified associated PR metadata and complete checks/status. Confirm issue association, repository, PR number, base branch, state and observed head; keep passed/failed/pending/skipped/neutral/unknown distinct. Without optional GitHub coverage, preserve existing catalog files; a stale time binding may safely hide them. Never invent PR/check observations.

Keep credentials in the authorized connector or logged-in CLI session; never write credentials into config, snapshots, catalog or browser overlays. The starter neither installs capabilities nor signs in to accounts. Demo setup uses synthetic examples in a separate external home; real setup creates only config before an authorized refresh.

1. Read the starter's CODEX_SNAPSHOT.md and external FOCUS_SHELF_HOME/config.json. Confirm the requested profile, owner and workspace; do not use personal defaults.
2. Through already authorized capabilities, obtain the complete current assigned plus followed issue set and relations. Retain prior followed IDs including Done items. If completeness is unavailable, preserve the previous local snapshot and explain the gap.
3. Build the strict allowlisted candidate outside the repository. Never include descriptions, comments, attachments, customer data, credentials, raw service responses or error bodies.
4. Run `node scripts/write-codex-snapshot.mjs INPUT.json` with the correct FOCUS_SHELF_HOME. Destination is fixed and external; respect lock contention and reread latest evidence before retrying.
5. Verify local `http://localhost:8770` through the running starter and report publication evidence. If occupied, do not stop an existing service or change origin. Memo, Archive, manual PR status and saved webpages are browser-local and must remain unchanged by refresh.

Setup: Node 22+, external FOCUS_SHELF_HOME, `npm start`. The server serves localhost:8770 only. Opening/editing/reloading never reads Linear/GitHub. Browser-local overlays require a valid identity and Web Locks; a second same-profile window is read-only. Without complete external evidence, preserve existing files. Remote publication, sharing, deployment, migration and messages require separate authorization.
