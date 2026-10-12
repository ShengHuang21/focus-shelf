# Focus Shelf

A local, on-demand view of your Linear tickets and related GitHub PRs. Codex gathers updates when you ask; the page does not sync with either service on its own.

## Architecture

![Focus Shelf architecture](docs/architecture.svg)

No database or Docker. The local server serves the page and reads the Git-ignored `.focus-shelf/` folder. Memo, Archive, and manual PR selections are saved there, so they remain available across browsers using the same local shelf.

## Before you start

- Node.js 22+, Git, a browser, and Codex with access to this checkout.
- Authorized Linear connector/MCP access to read tickets, plus GitHub CLI or connector access for PR/CI details. Sign in through those tools as needed; never put credentials in this repository.
- Know which Linear workspace and person this shelf is for. Codex can help confirm the exact owner ID and GitHub account before the first refresh.

## Quick start

1. Clone this repository and open its folder in Codex:

   ```sh
   git clone https://github.com/ShengHuang21/focus-shelf.git
   cd focus-shelf
   ```

2. Give Codex this one-time setup request:

   > Please set up Focus Shelf for me in this checkout. Use this repository's `skills/focus-shelf/SKILL.md`, `skills/generate-focus-shelf-icon/SKILL.md`, and `CODEX_SNAPSHOT.md`, not personal defaults. Confirm my Linear workspace and owner, GitHub identity, timezone, and local URL. Create my config in the Git-ignored `.focus-shelf/` folder, then perform the complete first refresh of my assigned, created, and followed tickets and their related PRs. Validate the data before saving, start the local server, and show me the page. Do not copy demo data or guess an identity; if required Linear coverage is missing, keep existing data unchanged; report any optional PR/CI gaps without guessing.

3. Open [http://localhost:8770](http://localhost:8770) after Codex starts the server. If you set it up manually instead, copy `examples/config.example.json` to `.focus-shelf/config.json`, replace the demo identity, then run `npm start`.

## Keeping it current

Ask Codex in ordinary language, for example:

- “Update ELT-536 in my Focus Shelf.”
- “Check PR #163 and update its linked ticket in my Focus Shelf.”
- “Update my whole Focus Shelf, including tickets and related PRs.”

The bundled Skill handles a scoped update or an incremental whole-shelf refresh and validates the local files before saving. You can also use the page's **Update** button to copy a request for Codex, but it is optional: the button does not fetch Linear or GitHub data. Reloading the page only rereads the latest local files.

Git ignores your `.focus-shelf/` data by default. Back it up before deleting the checkout. Use a separate local data folder and port when trying another person's shelf.
