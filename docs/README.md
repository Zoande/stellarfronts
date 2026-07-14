# StellarFronts Documentation

Engineering-led documentation for the StellarFronts prototype. Each system doc explains both the
**gameplay model** and **how to extend it safely**. Docs are written against the code as it exists —
file paths are clickable links you can follow to verify any claim.

> If a doc and the code ever disagree, the code wins. Fix the doc (and tell the next person).

## Where to start

If you are new, read [`must-read/`](must-read/) top to bottom first. It is enough to understand the
project and to make a safe change. Everything else is reference you pull in as needed.

## Folders

| Folder | What's in it |
| --- | --- |
| [`must-read/`](must-read/) | Project overview, architecture, the versioning/schema rules, backward-compatibility discipline, contributing rules, and local dev setup. Read this first. |
| [`systems/`](systems/) | One doc per gameplay system (economy, research, combat, diplomacy, …). Each covers the shared `src/data/*` model, its server-side processing, and how to extend it. |
| [`server/`](server/) | Server runtime engineering: the tick loop, persistence/normalization, the wire protocol, the orchestrator/version lifecycle, and auth. |
| [`client/`](client/) | Client engineering: app flow/boot, BabylonJS scenes and renderers, the DOM overlay panels, and the server client. |
| [`reference/`](reference/) | Lookup material: the `GameState` data model, the admin-command catalog, and a glossary. |

## Suggested reading order

1. [`must-read/01-project-overview.md`](must-read/01-project-overview.md)
2. [`must-read/02-architecture.md`](must-read/02-architecture.md)
3. [`must-read/03-versioning-and-schema.md`](must-read/03-versioning-and-schema.md)
4. [`must-read/04-backward-compatibility.md`](must-read/04-backward-compatibility.md)
5. [`must-read/05-contributing-rules.md`](must-read/05-contributing-rules.md)
6. [`must-read/06-local-dev-and-environments.md`](must-read/06-local-dev-and-environments.md)
7. Then dip into [`systems/`](systems/), [`server/`](server/), [`client/`](client/) for whatever you're touching.

## Doc conventions

- **Cite the source.** Claims link to the file (and often the function) they come from.
- **Two trailing sections** on system/server/client docs: *How to extend / rules* and *Key files*.
- **Honesty about maturity.** WIP or stub areas are labelled, not dressed up.
- **No invented APIs.** If a doc names a constant or function, it exists in the tree at the cited path.
