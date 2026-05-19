# StellarFronts Prototype

StellarFronts is a browser-based space strategy prototype with a Vite/React client, a websocket game server, and a separate HTTP auth server. The current build is authenticated end to end: login and signup happen against the auth service, and the game server derives the player perspective from the authenticated account instead of trusting the browser.

## Current State

The project now includes a real account system, session cookies, a separate auth service, server-side perspective handling, and a cleaned-up in-game logout path. User-created accounts are treated as observers, while the seeded faction accounts are the only ones bound to factions. Logout is now part of the game HUD and tears down the active game UI instead of leaving the clock/resources behind.

## Run Locally

1. Install dependencies with `npm install`.
2. Start the full stack with `npm run dev:all`.
3. Open `http://localhost:5173` in your browser.

Available scripts:

- `npm run dev` starts the client only.
- `npm run server:dev` starts the websocket game server on `ws://localhost:8787`.
- `npm run auth:dev` starts the auth server on `http://localhost:8788`.
- `npm run dev:all` starts client, auth, and game servers together.
- `npm run server:test` runs the server tests.
- `npm run server:typecheck` type-checks the server/shared TS files.
- `npm run build` produces a production client build.

## App Layout

- Home route: command dashboard, account summary, and launch point.
- Game route: BabylonJS-backed strategy view with an imperative HUD.
- Login and signup routes: auth forms backed by the auth server.

## Core Gameplay Loop

The game is currently a logistics and expansion prototype rather than a full war game. The main loop is:

1. Log in as an observer or a seeded faction account.
2. Open the galaxy map and inspect discovered stars and connected systems.
3. Move ships through the hyperlane network.
4. Build starbases from ships, then upgrade them and add orbital infrastructure.
5. Develop habited planets by adding districts, planet buildings, and urban sub-districts.
6. Watch economy, population, and resource production change over time as the clock advances.

## Economy System

The economy is implemented at both the planet and faction level.

Planet-level systems include:

- Resource production and upkeep for food, minerals, energy, goods, alloys, and research.
- Population, species population groups, employment, unemployment, housing, amenities, happiness, crime, and stability.
- Job classes and job slots such as administrators, researchers, artisans, metallurgists, entertainers, enforcers, farmers, miners, technicians, clerks, and unemployed pops.
- District construction for city, generator, mining, and agriculture districts.
- Planet buildings with compatibility rules for district slots and urban sub-district slots.
- Urban sub-district types that can be changed, with incompatible buildings being removed when a sub-district changes.
- Construction queues for districts and buildings.
- Population growth and decline based on housing, amenities, stability, crime, employment, and capacity pressure.

Faction-level systems include:

- Resource stockpiles and monthly resource deltas.
- Economy updates driven by owned habited planets and orbital infrastructure.

Habited planets start with a population baseline and starter infrastructure, so there is already a working economy loop at game start.

## Military And Expansion

The current military layer is focused on movement, control, and orbital buildup rather than direct combat.

Implemented systems include:

- Ships with transit phases for idle, departing, jumping hyperlane, arriving, and building starbase.
- Ship movement across the hyperlane network.
- Building a starbase from a ship at a target star.
- Starbase levels from outpost to star fortress.
- Starbase building slots with infrastructure like shipyards, solar arrays, hydroponics bays, orbital fabricators, alloy assembly docks, research annexes, and logistics depots.
- Corvette production from completed shipyards.
- Faction-bound starbase ownership and upkeep costs.
- Fog-of-war style star visibility for faction perspectives.

Important caveat: direct combat is not implemented yet. The protocol still has an `attack` ship action type in the shared types, but there is no server-side combat handler wired up in the current gameplay loop.

## Exploration And Visibility

The galaxy is procedurally generated and deterministic. The game includes:

- A seeded galaxy map with 500 stars.
- Faction home star assignment from the star field.
- Observer and faction perspectives.
- Faction visibility based on jump distance from the home system.
- Galaxy and system scene transitions in the client.

## Authentication

Accounts are stored on the auth server in SQLite at `server/state/auth.sqlite`. Sessions use an HttpOnly cookie named `sf_session`, and the server keeps the session token hashed rather than storing it in plain text.

Seeded accounts:

- `observer` / `observer`
- `color_1` / `color_1`
- `color_2` / `color_2`
- `color_3` / `color_3`
- `color_4` / `color_4`
- `color_5` / `color_5`
- `color_6` / `color_6`
- `color_7` / `color_7`
- `color_8` / `color_8`
- `color_9` / `color_9`
- `color_10` / `color_10`
- `color_11` / `color_11`
- `color_12` / `color_12`
- `color_13` / `color_13`
- `color_14` / `color_14`
- `color_15` / `color_15`

User-created accounts can use any unused username and password. They are created as observer accounts for gameplay.

Google and Microsoft login buttons are placeholders and currently disabled. Email verification is disabled for now.

## Persistence

- Game state lives in `server/state/game-state.json`.
- Auth data lives in the SQLite auth database under `server/state/auth.sqlite`.
- Auth database sidecar files are local runtime artifacts and are ignored by git.

## Dev Notes

- `server/index.ts` hosts the websocket game server.
- `server/auth-server.ts` hosts the auth API.
- The client talks to the auth server over HTTP and the game server over websocket.
- The project uses PBKDF2 password hashing and SQLite for local persistence.

## Deployment & Production Configuration

StellarFronts is designed to run across two deployment targets:

1. **Frontend**: Vercel (or other static host)
2. **Backend**: Raspberry Pi with Cloudflare Tunnel

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Internet / Vercel                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ https://stellarfronts.com (Frontend SPA)               │   │
│  │ https://www.stellarfronts.com (Frontend SPA)           │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│              Cloudflare Tunnel (stellarfronts-game)              │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ api.stellarfronts.com ──→ localhost:8788 (Auth API)      │   │
│  │ ws.stellarfronts.com  ──→ localhost:8787 (Game WebSocket)│   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│                    Raspberry Pi Backend                          │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ :8788 Auth Server (HTTP)                                 │   │
│  │ :8787 Game Server (WebSocket)                            │   │
│  │ Game state & auth database (SQLite)                      │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Frontend Environment Variables (Vercel)

Set these in Vercel project settings or `.env.production`:

```env
VITE_AUTH_SERVER_URL=https://api.stellarfronts.com
VITE_WS_URL=wss://ws.stellarfronts.com
```

### Backend Environment Variables (Raspberry Pi)

Set these before starting the servers:

```bash
# Auth Server (port 8788)
export AUTH_SERVER_PORT=8788
export ALLOWED_ORIGINS=https://stellarfronts.com,https://www.stellarfronts.com
export ADMIN_PASSWORD=ABDUGYA1398
export DEV_PANEL_PASSWORD=ABDUGYA1398

# Game/WebSocket Server (port 8787)
export GAME_SERVER_PORT=8787
export WS_ALLOWED_ORIGINS=https://stellarfronts.com,https://www.stellarfronts.com

# Session Cookies (for HTTPS + cross-subdomain)
export COOKIE_DOMAIN=.stellarfronts.com
export COOKIE_SECURE=true
```

### Cloudflare Tunnel Configuration

File: `~/.cloudflared/config.yml`

```yaml
tunnel: stellarfronts-game
credentials-file: /home/pi/.cloudflare/TUNNEL_ID.json

ingress:
  - hostname: api.stellarfronts.com
    service: http://localhost:8788
    originRequest:
      disableChunkedEncoding: false

  - hostname: ws.stellarfronts.com
    service: http://localhost:8787
    originRequest:
      disableChunkedEncoding: false

  - service: http_status:404
```

### DNS Records (Cloudflare)

Create CNAME records pointing to your Cloudflare Tunnel:

```
api.stellarfronts.com    CNAME    <TUNNEL_ID>.cfargotunnel.com    (Proxied)
ws.stellarfronts.com     CNAME    <TUNNEL_ID>.cfargotunnel.com    (Proxied)
```

### Running on Raspberry Pi

#### Option 1: Manual with npm (for testing)

```bash
cd ~/stellar-fronts
export COOKIE_DOMAIN=.stellarfronts.com
export COOKIE_SECURE=true
export ALLOWED_ORIGINS=https://stellarfronts.com,https://www.stellarfronts.com
export WS_ALLOWED_ORIGINS=https://stellarfronts.com,https://www.stellarfronts.com
export ADMIN_PASSWORD=ABDUGYA1398
export DEV_PANEL_PASSWORD=ABDUGYA1398

# Run both servers
npm run server:dev &  # or: tsx server/index.ts
npm run auth:dev      # or: tsx server/auth-server.ts
```

#### Option 2: systemd service (recommended for 24/7)

Create `/etc/systemd/system/stellar-fronts-game.service`:

```ini
[Unit]
Description=StellarFronts Game Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/stellar-fronts
Environment="COOKIE_DOMAIN=.stellarfronts.com"
Environment="COOKIE_SECURE=true"
Environment="ALLOWED_ORIGINS=https://stellarfronts.com,https://www.stellarfronts.com"
Environment="WS_ALLOWED_ORIGINS=https://stellarfronts.com,https://www.stellarfronts.com"
Environment="ADMIN_PASSWORD=ABDUGYA1398"
Environment="DEV_PANEL_PASSWORD=ABDUGYA1398"
ExecStart=/usr/bin/npm run server:dev
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/stellar-fronts-auth.service`:

```ini
[Unit]
Description=StellarFronts Auth Server
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/stellar-fronts
Environment="COOKIE_DOMAIN=.stellarfronts.com"
Environment="COOKIE_SECURE=true"
Environment="ALLOWED_ORIGINS=https://stellarfronts.com,https://www.stellarfronts.com"
Environment="ADMIN_PASSWORD=ABDUGYA1398"
Environment="DEV_PANEL_PASSWORD=ABDUGYA1398"
ExecStart=/usr/bin/npm run auth:dev
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable stellar-fronts-game stellar-fronts-auth stellar-fronts-tunnel
sudo systemctl start stellar-fronts-game stellar-fronts-auth stellar-fronts-tunnel
```

### Verification Commands

#### Test Local Auth API

```bash
# Health check
curl http://localhost:8788/health

# Login
curl -X POST http://localhost:8788/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"observer","password":"observer"}'

# Get session
curl -b "sf_session=TOKEN" http://localhost:8788/api/me
```

#### Test Production Auth API (via Cloudflare)

```bash
# Health check
curl https://api.stellarfronts.com/health

# Login (will return Set-Cookie header)
curl -v -c cookies.txt \
  -X POST https://api.stellarfronts.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"observer","password":"observer"}'

# Get session (uses stored cookie)
curl -v -b cookies.txt https://api.stellarfronts.com/api/me
```

#### Test WebSocket Locally

```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8787', {
  headers: { Cookie: 'sf_session=TOKEN_FROM_LOGIN' }
});
ws.on('open', () => console.log('Connected'));
ws.on('message', (m) => console.log('Received:', m.substring(0, 200)));
ws.on('error', (e) => console.error('Error:', e.message));
setTimeout(() => ws.close(), 5000);
"
```

#### Test WebSocket Production (via Cloudflare)

```bash
node -e "
const WebSocket = require('ws');
const fetch = require('node-fetch');

(async () => {
  // 1. Login to get session cookie
  const login = await fetch('https://api.stellarfronts.com/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'observer', password: 'observer' })
  });
  const setCookie = login.headers.get('set-cookie');
  const sessionCookie = setCookie.split(';')[0];

  // 2. Connect to WebSocket with cookie
  const ws = new WebSocket('wss://ws.stellarfronts.com', {
    headers: {
      Cookie: sessionCookie,
      Origin: 'https://stellarfronts.com'
    }
  });

  ws.on('open', () => console.log('WebSocket connected'));
  ws.on('message', (m) => console.log('Received:', m.toString().substring(0, 200)));
  ws.on('error', (e) => console.error('Error:', e.message));
  ws.on('close', (code) => console.log('Closed:', code));

  setTimeout(() => ws.close(), 8000);
})().catch(console.error);
"
```

### CORS & Security Notes

- **Auth server**: Only allows requests from `ALLOWED_ORIGINS`. Set to your frontend domains in production.
- **WebSocket server**: Only allows connections from `WS_ALLOWED_ORIGINS`. Rejects requests with disallowed `Origin` header.
- **Session cookies**: In production, set `COOKIE_DOMAIN=.stellarfronts.com` so the cookie is shared between `api.stellarfronts.com` and the frontend at `stellarfronts.com`.
- **HTTPS**: Both APIs must use HTTPS in production. Cloudflare Tunnel handles TLS termination.

### Troubleshooting

**Issue: "CORS error" when login button clicked**
- Ensure `ALLOWED_ORIGINS` includes your frontend domain.
- Check browser console for exact origin being rejected.

**Issue: WebSocket connection fails in production**
- Verify `WS_ALLOWED_ORIGINS` includes your frontend domain.
- Ensure `COOKIE_SECURE=true` so HttpOnly cookies are sent over HTTPS.
- Check cookie has `Domain=.stellarfronts.com` so it's sent to `ws.stellarfronts.com`.

**Issue: Cookie not shared between subdomains**
- Verify `COOKIE_DOMAIN` is set to `.stellarfronts.com` (with leading dot).
- Verify `COOKIE_SECURE=true` for HTTPS.
- Check browser DevTools > Application > Cookies: domain should show `.stellarfronts.com`.

### Local Development (No Env Vars Needed)

```bash
npm run dev:all
# Frontend: http://localhost:5173
# Auth: http://localhost:8788
# Game: ws://localhost:8787
```

CORS and cookies work automatically for localhost + 127.0.0.1.
