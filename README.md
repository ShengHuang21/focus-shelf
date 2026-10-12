# Focus Shelf

A local, on-demand view of your Linear tickets and related GitHub PRs. Codex gathers updates when you ask; the page does not sync with either service on its own.

## Architecture

![Focus Shelf architecture](docs/architecture.svg)

No database or Docker. The local server serves the page and reads the Git-ignored `.focus-shelf/` folder. Memo, Archive, and manual PR selections are saved there, so they remain available across browsers using the same local shelf.

## Before you start

- Node.js 22+, Git, a browser, and Codex with access to this checkout.
- Authorized Linear connector/MCP access to read tickets, plus GitHub CLI or connector access for PR/CI details. Sign in through those tools as needed; never put credentials in this repository.
- Know which Linear workspace and person this shelf is for. Codex can help confirm the exact owner ID and GitHub account before the first refresh.

## Quick start with Codex

Paste this into Codex. It will clone the repository and set up your own shelf:

> Set up Focus Shelf for me from https://github.com/ShengHuang21/focus-shelf.git. Clone the repository if needed, then use its bundled `skills/focus-shelf/SKILL.md`, `skills/generate-focus-shelf-icon/SKILL.md`, and `CODEX_SNAPSHOT.md`—not personal defaults. Confirm my Linear workspace and owner, GitHub identity, timezone, and local URL. Keep my config and data in the Git-ignored `.focus-shelf/` folder. Perform the complete first refresh of my assigned, created, and followed tickets and related PRs; validate before saving. Start the local server and show me the page. Do not use demo data or guess my identity. If required Linear coverage is missing, leave existing data unchanged and tell me what is missing.

## Manual quick start (demo)

```sh
git clone https://github.com/ShengHuang21/focus-shelf.git
cd focus-shelf
mkdir -p .focus-shelf
cp examples/config.example.json .focus-shelf/config.json
cp examples/snapshot.example.json .focus-shelf/linear-latest.json
cp examples/catalog.example.json .focus-shelf/catalog.json
npm start
```

Open [http://localhost:8770](http://localhost:8770). This runs a local demo only; it does not sign in to Linear or GitHub or fetch your tickets. To build your own shelf, use the Codex setup prompt above.

## Keeping it current

Ask Codex in ordinary language, for example:

- “Update ELT-536 in my Focus Shelf.”
- “Check PR #163 and update its linked ticket in my Focus Shelf.”
- “Update my whole Focus Shelf, including tickets and related PRs.”

The bundled Skill handles a scoped update or an incremental whole-shelf refresh and validates the local files before saving. You can also use the page's **Update** button to copy a request for Codex, but it is optional: the button does not fetch Linear or GitHub data. Reloading the page only rereads the latest local files.

Git ignores your `.focus-shelf/` data by default. Back it up before deleting the checkout. Use a separate local data folder and port when trying another person's shelf.
