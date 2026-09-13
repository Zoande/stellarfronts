# Auth & Accounts

A separate HTTP server handles accounts, sessions, the game catalog, and the dev panel — independent
of the game-server WebSocket. Source: [`server/auth-server.ts`](../../server/auth-server.ts)
(HTTP routing) and [`server/auth-store.ts`](../../server/auth-store.ts) (SQLite-backed store).

## Storage

Everything persists to `server/state/auth.sqlite`. Each process explicitly constructs one
[`AuthStore`](../../server/auth-store.ts) facade and closes it during shutdown; there is no eager
module singleton. [`AuthDatabase`](../../server/auth-database.ts) owns the connection, while
domain repositories share that connection for accounts/sessions, games/runtime catalog, news,
progression, and direct messages. Passwords are hashed with **PBKDF2**.

## Sessions

Login issues an HttpOnly cookie `sf_session`. The game server validates the WebSocket connection by
resolving that cookie against the injected auth-store port (see `attachClient` /
[`server/game-runtime.ts`](../../server/game-runtime.ts)). The dev panel uses a separate dev-session cookie.

## HTTP endpoints

Routed in [`server/auth-server.ts`](../../server/auth-server.ts) (subset):

| Route | Purpose |
| --- | --- |
| `GET /api/me` | Current session/account. |
| `POST /api/login`, `/api/signup`, `/api/logout` | Account auth. |
| `GET /api/games` | Game catalog (joined via the gateway in prod). |
| `POST /api/dev/login`, `/api/dev/logout`, `GET /api/dev/stats`, `POST /api/dev/games` | Dev panel. |
| `GET/POST /api/admin/news/...`, `GET /api/news/posts` | News posts/media. |
| `GET /api/messages`, `POST /api/messages/send` | Direct messages. |
| `GET /api/player/profile`, `POST /api/player/quests/:questId/claim` | Player profile and quest reward claims. |
| `POST /api/internal/game-xp` | Control-token-gated in-game XP awards. |
| `POST /api/oauth/google`, `/api/oauth/microsoft` | **Return `501` — OAuth not enabled.** |
| `GET /health`, `/robots.txt`, `/sitemap.xml`, `/news` | Ops / SEO / news page. |

CORS is gated by `ALLOWED_ORIGINS`; the game server's WebSocket origin allow-list is
`WS_ALLOWED_ORIGINS`.

## Seeded accounts

`seedAccounts` ([`server/auth-store.ts`](../../server/auth-store.ts)) creates on first run:

- `observer` / `observer` — read-only spectator.
- `admin` / `$ADMIN_PASSWORD` — privileged; observer-style access plus admin commands.
  `ADMIN_PASSWORD` is required and the process fails to start if it is unset or empty.
  `isAdminAccount` / `isPrivilegedGameAccount` drive access.
- `color_1` … `color_15` (password = username) — one ordinary player per faction slot.

Observer and admin accounts join games in **observer mode** (read-only, full-map view); ordinary
accounts claim a generated country (faction). The perspective an account gets is decided in the auth
store (`isPrivilegedGameAccount` → `{ mode: 'observer' }`) and enforced by the game server on every
command.

## Account progression

XP, levels, achievements, quest windows, and Dark Matter are stored per account in the progression
tables. Dark Matter therefore carries across games and is intentionally separate from faction
stockpiles. Reward insertion and spending are atomic: achievements and quest windows can be claimed
once, while `spendPlayerDarkMatter` debits only when the full requested balance is available. The
game server maps a game/faction back to its owning account when it needs to bill a recurring fleet
boost. Gameplay details are in
[`../systems/account-progression-and-dark-matter.md`](../systems/account-progression-and-dark-matter.md).

## How to extend / rules

- Account/session logic belongs in the auth store; the game server only *consumes* a validated
  session and perspective.
- Don't trust the client's claimed identity — the game server re-derives perspective from the session.
- New seeded accounts/roles go through `seedAccounts`; keep observer/admin read-only semantics intact.
- Account-scoped currencies belong in auth SQLite, not `GameState`; game-server mutations must send
  an account-resource update to every connected session for that account.

## Known limitations

- OAuth endpoints return `501` (not wired up).
- Email verification ([`src/pages/EmailVerificationPage.tsx`](../../src/pages/EmailVerificationPage.tsx))
  is a UI shell with no backend flow.

## Key files

- HTTP server: [`server/auth-server.ts`](../../server/auth-server.ts).
- Store: [`server/auth-store.ts`](../../server/auth-store.ts).
- Database/repositories: [`server/auth-database.ts`](../../server/auth-database.ts),
  [`server/auth-repositories.ts`](../../server/auth-repositories.ts).
- Client: [`src/auth/client.ts`](../../src/auth/client.ts), [`src/auth/types.ts`](../../src/auth/types.ts).
- Tests: [`server/tests/auth-store.test.ts`](../../server/tests/auth-store.test.ts).
