import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, pbkdf2Sync, timingSafeEqual, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { buildFactions } from '../src/data/Factions';
import { FACTION_COUNT } from '../src/data/Factions';
import { GALAXY_MAP } from '../src/data/GalaxyMap';
import { generateStarMap } from '../src/data/StarMap';
import type { GalaxyPerspective } from '../src/data/Factions';
import {
  FLAG_COLORS,
  FLAG_CONTAINERS,
  FLAG_PATTERNS,
  FLAG_SYMBOLS,
  createFlagDesign,
} from '../src/flags/flagGenerator';
import type { FlagDesign } from '../src/flags/flagTypes';
import type {
  AuthAccount,
  AccountType,
  Credentials,
  DevGameRuntimeRow,
  DevGameRuntimeStats,
  DevStatsResponse,
  GameMembership,
  GameSummary,
} from '../src/auth/types';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEV_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEV_ACTIVITY_SERIES_DAYS = 14;
const GAME_RUNTIME_STALE_MS = 20_000;
const DEFAULT_DEV_PANEL_PASSWORD = 'ABDUGYA1398';
const ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'ABDUGYA1398';
const SESSION_COOKIE_NAME = 'sf_session';
const DEV_SESSION_COOKIE_NAME = 'sf_dev_session';
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_DIGEST = 'sha512';

type DatabaseInstance = InstanceType<typeof Database>;
type DevEventType = 'login' | 'signup' | 'game_enter';

interface AccountRow {
  id: number;
  username: string;
  password_salt: string;
  password_hash: string;
  account_type: AccountType;
  faction_id: number | null;
  created_at: number;
  updated_at: number;
}

interface SessionRow {
  token_hash: string;
  account_id: number;
  created_at: number;
  expires_at: number;
}

interface DevEventRow {
  event_type: DevEventType;
  account_id: number | null;
  username: string | null;
  occurred_at: number;
}

interface LatestAccountRow {
  id: number;
  username: string;
  account_type: AccountType;
  faction_id: number | null;
  created_at: number;
  last_login_at: number | null;
  login_count: number;
  game_enter_count: number;
}

interface GameRow {
  id: string;
  name: string;
  seed: number;
  country_capacity: number;
  created_at: number;
}

interface GameSummaryRow extends GameRow {
  controlled_countries: number;
  faction_id: number | null;
  country_name: string | null;
  flag_design: string | null;
  joined_at: number | null;
  last_entered_at: number | null;
}

interface MembershipRow {
  game_id: string;
  account_id: number;
  faction_id: number;
  country_name: string;
  flag_design: string | null;
  joined_at: number;
}

export interface StoredGame {
  id: string;
  name: string;
  seed: number;
  countryCapacity: number;
  createdAt: number;
}

class AuthError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pickCatalogItem<T extends { id: string }>(items: T[], id: unknown): T | null {
  if (typeof id !== 'string') return null;
  return items.find((item) => item.id === id) ?? null;
}

function getNestedId(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  const nested = value[key];
  if (isRecord(nested)) return nested.id;
  return undefined;
}

function sanitizeFlagDesignInput(input: unknown): FlagDesign | null {
  if (!isRecord(input)) return null;

  const container = pickCatalogItem(FLAG_CONTAINERS, getNestedId(input, 'container') ?? input.containerId);
  const backgroundColor = pickCatalogItem(FLAG_COLORS, getNestedId(input, 'backgroundColor') ?? input.colorId ?? input.backgroundColorId);
  const accentColor = pickCatalogItem(FLAG_COLORS, getNestedId(input, 'accentColor') ?? input.accentColorId);
  const pattern = pickCatalogItem(FLAG_PATTERNS, getNestedId(input, 'pattern') ?? input.patternId);
  const primarySymbol = pickCatalogItem(FLAG_SYMBOLS, getNestedId(input, 'primarySymbol') ?? input.primarySymbolId);
  const secondarySymbolInput = getNestedId(input, 'secondarySymbol') ?? input.secondarySymbolId;
  const secondarySymbol = secondarySymbolInput === undefined || secondarySymbolInput === null || secondarySymbolInput === ''
    ? undefined
    : pickCatalogItem(FLAG_SYMBOLS, secondarySymbolInput) ?? undefined;

  if (!container || !backgroundColor || !accentColor || !pattern || !primarySymbol) return null;
  if (secondarySymbolInput && !secondarySymbol) return null;

  return {
    container,
    backgroundColor,
    accentColor,
    pattern,
    primarySymbol,
    secondarySymbol,
  };
}

function parseStoredFlagDesign(value: string | null): FlagDesign | null {
  if (!value) return null;
  try {
    return sanitizeFlagDesignInput(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString('hex');
}

function makePasswordSalt(): string {
  return randomBytes(16).toString('hex');
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createSessionToken(): string {
  return randomBytes(32).toString('hex');
}

function createGameId(): string {
  return randomBytes(12).toString('hex');
}

function createGameSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

function getDevPanelPassword(): string {
  return process.env.DEV_PANEL_PASSWORD ?? DEFAULT_DEV_PANEL_PASSWORD;
}

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
}

function safeStringEquals(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function passwordMatches(password: string, salt: string, expectedHash: string): boolean {
  const actualHash = Buffer.from(hashPassword(password, salt), 'hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  if (actualHash.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualHash, expectedBuffer);
}

function buildSeedAccounts(): Array<{ username: string; password: string; accountType: AccountType; factionId: number | null }> {
  const initialStars = generateStarMap(
    GALAXY_MAP.width,
    GALAXY_MAP.height,
    GALAXY_MAP.starCount,
    GALAXY_MAP.seed,
    GALAXY_MAP.minStarSpacing,
    GALAXY_MAP.shape,
  );

  return [
    ...buildFactions(initialStars, GALAXY_MAP).map((faction) => ({
      username: `color_${faction.id + 1}`,
      password: `color_${faction.id + 1}`,
      accountType: 'user' as const,
      factionId: null,
    })),
    {
      username: 'observer',
      password: 'observer',
      accountType: 'observer' as const,
      factionId: null,
    },
  ];
}

export class AuthStore {
  private readonly db: DatabaseInstance;

  constructor(dbPath = path.join(process.cwd(), 'server', 'state', 'auth.sqlite')) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        account_type TEXT NOT NULL,
        faction_id INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
      CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

      CREATE TABLE IF NOT EXISTS dev_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dev_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        account_id INTEGER,
        username TEXT,
        occurred_at INTEGER NOT NULL,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS game_runtime_stats (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        seed INTEGER NOT NULL,
        country_capacity INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS game_memberships (
        game_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        faction_id INTEGER NOT NULL,
        country_name TEXT NOT NULL,
        flag_design TEXT,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY(game_id, account_id),
        UNIQUE(game_id, faction_id),
        FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS game_visits (
        game_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        last_entered_at INTEGER NOT NULL,
        PRIMARY KEY(game_id, account_id),
        FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_dev_sessions_expires_at ON dev_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_dev_events_type_time ON dev_events(event_type, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_dev_events_account_id ON dev_events(account_id);
      CREATE INDEX IF NOT EXISTS idx_game_memberships_account_id ON game_memberships(account_id);
      CREATE INDEX IF NOT EXISTS idx_game_visits_account_id ON game_visits(account_id, last_entered_at);
    `);

    const membershipColumns = this.db.prepare(`PRAGMA table_info(game_memberships)`).all() as Array<{ name: string }>;
    if (!membershipColumns.some((column) => column.name === 'flag_design')) {
      this.db.exec(`ALTER TABLE game_memberships ADD COLUMN flag_design TEXT`);
    }

    this.db.prepare(`
      UPDATE accounts
      SET account_type = 'user', faction_id = NULL, updated_at = ?
      WHERE account_type = 'seeded-faction'
    `).run(Date.now());
    this.seedAccounts();
  }

  private seedAccounts(): void {
    mkdirSync(path.dirname(this.db.name), { recursive: true });
    const insertAccount = this.db.prepare(`
      INSERT OR IGNORE INTO accounts (username, password_salt, password_hash, account_type, faction_id, created_at, updated_at)
      VALUES (@username, @password_salt, @password_hash, @account_type, @faction_id, @created_at, @updated_at)
    `);

    const now = Date.now();
    for (const account of buildSeedAccounts()) {
      const salt = makePasswordSalt();
      insertAccount.run({
        username: normalizeUsername(account.username),
        password_salt: salt,
        password_hash: hashPassword(account.password, salt),
        account_type: account.accountType,
        faction_id: account.factionId,
        created_at: now,
        updated_at: now,
      });
    }

    this.ensureAdminAccount(now);
  }

  getReservedUsernames(): Set<string> {
    return new Set([
      ...buildSeedAccounts().map((account) => normalizeUsername(account.username)),
      ADMIN_USERNAME,
    ]);
  }

  isAdminAccount(account: AuthAccount): boolean {
    return account.accountType === 'admin' && normalizeUsername(account.username) === ADMIN_USERNAME;
  }

  isPrivilegedGameAccount(account: AuthAccount): boolean {
    return account.accountType === 'observer' || this.isAdminAccount(account);
  }

  createGame(nameInput: string): StoredGame {
    const name = nameInput.trim();
    if (!name) {
      throw new AuthError('Game name is required', 400);
    }
    if (name.length > 80) {
      throw new AuthError('Game name must be 80 characters or fewer', 400);
    }
    if (this.db.prepare(`SELECT id FROM games WHERE name = ? COLLATE NOCASE`).get(name)) {
      throw new AuthError('Game name is already in use', 409);
    }

    const createdAt = Date.now();
    const game: StoredGame = {
      id: createGameId(),
      name,
      seed: createGameSeed(),
      countryCapacity: FACTION_COUNT,
      createdAt,
    };
    this.db.prepare(`
      INSERT INTO games (id, name, seed, country_capacity, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(game.id, game.name, game.seed, game.countryCapacity, game.createdAt);
    return game;
  }

  deleteGame(gameId: string): StoredGame | null {
    const game = this.getGameById(gameId);
    if (!game) return null;
    this.db.prepare(`DELETE FROM games WHERE id = ?`).run(game.id);
    return game;
  }

  getGameById(gameId: string): StoredGame | null {
    const row = this.db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId) as GameRow | undefined;
    return row ? this.toGame(row) : null;
  }

  listGames(): StoredGame[] {
    const rows = this.db.prepare(`SELECT * FROM games ORDER BY created_at DESC, id ASC`).all() as GameRow[];
    return rows.map((row) => this.toGame(row));
  }

  getGameSummariesForAccount(account: AuthAccount): GameSummary[] {
    const rows = this.db.prepare(`
      SELECT
        g.*,
        COUNT(all_members.account_id) AS controlled_countries,
        own_members.faction_id,
        own_members.country_name,
        own_members.flag_design,
        own_members.joined_at,
        visits.last_entered_at
      FROM games g
      LEFT JOIN game_memberships all_members ON all_members.game_id = g.id
      LEFT JOIN game_memberships own_members ON own_members.game_id = g.id AND own_members.account_id = ?
      LEFT JOIN game_visits visits ON visits.game_id = g.id AND visits.account_id = ?
      GROUP BY g.id, own_members.faction_id, own_members.country_name, own_members.flag_design, own_members.joined_at, visits.last_entered_at
      ORDER BY COALESCE(visits.last_entered_at, 0) DESC, g.created_at DESC, g.id ASC
    `).all(account.id, account.id) as GameSummaryRow[];
    return rows.map((row) => this.toGameSummary(row, account));
  }

  getGameSummaryForAccount(gameId: string, account: AuthAccount): GameSummary | null {
    return this.getGameSummariesForAccount(account).find((game) => game.id === gameId) ?? null;
  }

  getGameMembership(gameId: string, accountId: number): GameMembership | null {
    const row = this.db.prepare(`
      SELECT game_id, account_id, faction_id, country_name, flag_design, joined_at
      FROM game_memberships
      WHERE game_id = ? AND account_id = ?
    `).get(gameId, accountId) as MembershipRow | undefined;
    return row ? this.toMembership(row) : null;
  }

  listGameMemberships(gameId: string): GameMembership[] {
    const rows = this.db.prepare(`
      SELECT game_id, account_id, faction_id, country_name, flag_design, joined_at
      FROM game_memberships
      WHERE game_id = ?
      ORDER BY faction_id ASC
    `).all(gameId) as MembershipRow[];
    return rows.map((row) => this.toMembership(row));
  }

  joinGame(account: AuthAccount, gameId: string, countryNameInput: string, flagDesignInput?: unknown): GameMembership | null {
    if (this.isPrivilegedGameAccount(account)) {
      if (!this.getGameById(gameId)) throw new AuthError('Game not found', 404);
      return null;
    }

    const countryName = countryNameInput.trim();
    if (!countryName) {
      throw new AuthError('Country name is required', 400);
    }
    if (countryName.length > 48) {
      throw new AuthError('Country name must be 48 characters or fewer', 400);
    }

    const membership = this.db.transaction(() => {
      const game = this.getGameById(gameId);
      if (!game) throw new AuthError('Game not found', 404);
      const current = this.getGameMembership(game.id, account.id);
      if (current) return current;

      const claimedRows = this.db.prepare(`
        SELECT faction_id
        FROM game_memberships
        WHERE game_id = ?
      `).all(game.id) as Array<{ faction_id: number }>;
      const claimed = new Set(claimedRows.map((row) => row.faction_id));
      const availableFactionIds = Array.from({ length: game.countryCapacity }, (_, factionId) => factionId)
        .filter((factionId) => !claimed.has(factionId));
      if (availableFactionIds.length === 0) {
        throw new AuthError('Game is full', 409);
      }

      const factionId = availableFactionIds[Math.floor(Math.random() * availableFactionIds.length)];
      const joinedAt = Date.now();
      const flagDesign = sanitizeFlagDesignInput(flagDesignInput)
        ?? createFlagDesign({ seed: `${game.id}:${account.id}:${countryName}` });
      this.db.prepare(`
        INSERT INTO game_memberships (game_id, account_id, faction_id, country_name, flag_design, joined_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(game.id, account.id, factionId, countryName, JSON.stringify(flagDesign), joinedAt);
      return this.getGameMembership(game.id, account.id);
    })();
    if (!membership) {
      throw new AuthError('Could not create game membership', 500);
    }
    return membership;
  }

  getGamePerspective(account: AuthAccount, gameId: string): GalaxyPerspective | null {
    if (!this.getGameById(gameId)) return null;
    if (this.isPrivilegedGameAccount(account)) return { mode: 'observer' };
    const membership = this.getGameMembership(gameId, account.id);
    return membership ? { mode: 'faction', factionId: membership.factionId } : null;
  }

  getAccountByUsername(username: string): AuthAccount | null {
    const row = this.db.prepare(`SELECT * FROM accounts WHERE username = ?`).get(normalizeUsername(username)) as AccountRow | undefined;
    return row ? this.toAccount(row) : null;
  }

  getAccountById(accountId: number): AuthAccount | null {
    const row = this.db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(accountId) as AccountRow | undefined;
    return row ? this.toAccount(row) : null;
  }

  getAccountFromSessionToken(token: string): AuthAccount | null {
    const tokenHash = hashSessionToken(token);
    const row = this.db.prepare(`
      SELECT a.*
      FROM sessions s
      JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(tokenHash, Date.now()) as AccountRow | undefined;

    if (!row) return null;
    return this.toAccount(row);
  }

  login(credentials: Credentials): { account: AuthAccount; token: string } {
    const username = normalizeUsername(credentials.username);
    const accountRow = this.db.prepare(`SELECT * FROM accounts WHERE username = ?`).get(username) as AccountRow | undefined;
    if (!accountRow) {
      throw new AuthError('Invalid username or password', 401);
    }

    if (!passwordMatches(credentials.password, accountRow.password_salt, accountRow.password_hash)) {
      throw new AuthError('Invalid username or password', 401);
    }

    const result = this.createSessionForAccount(accountRow);
    this.recordDevEvent('login', result.account);
    return result;
  }

  signup(credentials: Credentials): { account: AuthAccount; token: string } {
    const username = normalizeUsername(credentials.username);
    if (!username) {
      throw new AuthError('Username is required', 400);
    }
    if (!credentials.password.trim()) {
      throw new AuthError('Password is required', 400);
    }
    if (this.getReservedUsernames().has(username)) {
      throw new AuthError('That username is reserved', 409);
    }
    if (this.getAccountByUsername(username)) {
      throw new AuthError('Username is already taken', 409);
    }

    const salt = makePasswordSalt();
    const now = Date.now();
    const result = this.db.prepare(`
      INSERT INTO accounts (username, password_salt, password_hash, account_type, faction_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(username, salt, hashPassword(credentials.password, salt), 'user', null, now, now);

    const account = this.getAccountById(Number(result.lastInsertRowid));
    if (!account) {
      throw new AuthError('Could not create account', 500);
    }

    const token = this.createSession(account.id);
    this.recordDevEvent('signup', account);
    return { account, token };
  }

  createSession(accountId: number): string {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO sessions (token_hash, account_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(tokenHash, accountId, now, now + SESSION_TTL_MS);
    return token;
  }

  clearSession(token: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashSessionToken(token));
  }

  validateDevPassword(password: string): boolean {
    return safeStringEquals(password, getDevPanelPassword());
  }

  createDevSession(): string {
    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO dev_sessions (token_hash, created_at, expires_at)
      VALUES (?, ?, ?)
    `).run(tokenHash, now, now + DEV_SESSION_TTL_MS);
    return token;
  }

  isDevSessionTokenValid(token: string): boolean {
    const row = this.db.prepare(`
      SELECT token_hash
      FROM dev_sessions
      WHERE token_hash = ? AND expires_at > ?
    `).get(hashSessionToken(token), Date.now()) as { token_hash: string } | undefined;
    return !!row;
  }

  clearDevSession(token: string): void {
    this.db.prepare(`DELETE FROM dev_sessions WHERE token_hash = ?`).run(hashSessionToken(token));
  }

  recordGameEnter(account: AuthAccount, gameId?: string): void {
    this.recordDevEvent('game_enter', account);
    if (!gameId || !this.getGameById(gameId)) return;
    this.db.prepare(`
      INSERT INTO game_visits (game_id, account_id, last_entered_at)
      VALUES (?, ?, ?)
      ON CONFLICT(game_id, account_id) DO UPDATE SET
        last_entered_at = excluded.last_entered_at
    `).run(gameId, account.id, Date.now());
  }

  setGameRuntimeStats(stats: DevGameRuntimeStats): void {
    const now = Date.now();
    const runtimeStats: DevGameRuntimeStats = {
      ...stats,
      online: true,
      lastHeartbeatAt: now,
    };
    this.db.prepare(`
      INSERT INTO game_runtime_stats (key, value, updated_at)
      VALUES ('game', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(runtimeStats), now);
  }

  getDevStats(): DevStatsResponse {
    const now = Date.now();
    this.db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(now);
    this.db.prepare(`DELETE FROM dev_sessions WHERE expires_at <= ?`).run(now);

    return {
      generatedAt: now,
      accounts: this.getDevAccountsSummary(),
      activity: this.getDevActivitySummary(now),
      game: this.getGameRuntimeStats(now),
    };
  }

  private createSessionForAccount(accountRow: AccountRow): { account: AuthAccount; token: string } {
    const account = this.toAccount(accountRow);
    const token = this.createSession(account.id);
    return { account, token };
  }

  private recordDevEvent(eventType: DevEventType, account: AuthAccount): void {
    this.db.prepare(`
      INSERT INTO dev_events (event_type, account_id, username, occurred_at)
      VALUES (?, ?, ?, ?)
    `).run(eventType, account.id, account.username, Date.now());
  }

  private ensureAdminAccount(now: number): void {
    const salt = makePasswordSalt();
    this.db.prepare(`
      INSERT INTO accounts (username, password_salt, password_hash, account_type, faction_id, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', NULL, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        password_salt = excluded.password_salt,
        password_hash = excluded.password_hash,
        account_type = 'admin',
        faction_id = NULL,
        updated_at = excluded.updated_at
    `).run(
      ADMIN_USERNAME,
      salt,
      hashPassword(getAdminPassword(), salt),
      now,
      now,
    );
  }

  private getDevAccountsSummary(): DevStatsResponse['accounts'] {
    const summary = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN account_type = 'user' THEN 1 ELSE 0 END) AS users,
        SUM(CASE WHEN account_type = 'seeded-faction' THEN 1 ELSE 0 END) AS seeded_factions,
        SUM(CASE WHEN account_type = 'observer' THEN 1 ELSE 0 END) AS observers,
        SUM(CASE WHEN account_type = 'admin' THEN 1 ELSE 0 END) AS admins
      FROM accounts
    `).get() as { total: number; users: number | null; seeded_factions: number | null; observers: number | null; admins: number | null };

    const latestRows = this.db.prepare(`
      SELECT
        a.id,
        a.username,
        a.account_type,
        a.faction_id,
        a.created_at,
        (
          SELECT MAX(e.occurred_at)
          FROM dev_events e
          WHERE e.account_id = a.id AND e.event_type = 'login'
        ) AS last_login_at,
        (
          SELECT COUNT(*)
          FROM dev_events e
          WHERE e.account_id = a.id AND e.event_type = 'login'
        ) AS login_count,
        (
          SELECT COUNT(*)
          FROM dev_events e
          WHERE e.account_id = a.id AND e.event_type = 'game_enter'
        ) AS game_enter_count
      FROM accounts a
      ORDER BY a.created_at DESC
      LIMIT 12
    `).all() as LatestAccountRow[];

    return {
      total: Number(summary.total ?? 0),
      users: Number(summary.users ?? 0),
      seededFactions: Number(summary.seeded_factions ?? 0),
      observers: Number(summary.observers ?? 0),
      admins: Number(summary.admins ?? 0),
      latest: latestRows.map((row) => ({
        id: row.id,
        username: row.username,
        accountType: row.account_type,
        factionId: row.faction_id,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        loginCount: Number(row.login_count ?? 0),
        gameEnterCount: Number(row.game_enter_count ?? 0),
      })),
    };
  }

  private getDevActivitySummary(now: number): DevStatsResponse['activity'] {
    const recentCutoff = now - DAY_MS;
    const rows = this.db.prepare(`
      SELECT
        event_type,
        COUNT(*) AS total,
        SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) AS last_24h
      FROM dev_events
      GROUP BY event_type
    `).all(recentCutoff) as Array<{ event_type: DevEventType; total: number; last_24h: number | null }>;

    const totals: Record<DevEventType, { total: number; last24h: number }> = {
      login: { total: 0, last24h: 0 },
      signup: { total: 0, last24h: 0 },
      game_enter: { total: 0, last24h: 0 },
    };

    for (const row of rows) {
      if (!totals[row.event_type]) continue;
      totals[row.event_type] = {
        total: Number(row.total ?? 0),
        last24h: Number(row.last_24h ?? 0),
      };
    }

    const activeAuthSessions = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions
      WHERE expires_at > ?
    `).get(now) as { count: number };

    return {
      loginsTotal: totals.login.total,
      logins24h: totals.login.last24h,
      signupsTotal: totals.signup.total,
      signups24h: totals.signup.last24h,
      gameEntersTotal: totals.game_enter.total,
      gameEnters24h: totals.game_enter.last24h,
      activeAuthSessions: Number(activeAuthSessions.count ?? 0),
      series: this.getActivitySeries(now),
    };
  }

  private getActivitySeries(now: number): DevStatsResponse['activity']['series'] {
    const todayUtc = Math.floor(now / DAY_MS) * DAY_MS;
    const startUtc = todayUtc - (DEV_ACTIVITY_SERIES_DAYS - 1) * DAY_MS;
    const buckets = new Map<number, {
      timestamp: number;
      label: string;
      logins: number;
      signups: number;
      gameEnters: number;
      uniqueGameAccountsSet: Set<string>;
    }>();

    for (let index = 0; index < DEV_ACTIVITY_SERIES_DAYS; index += 1) {
      const timestamp = startUtc + index * DAY_MS;
      buckets.set(timestamp, {
        timestamp,
        label: new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        logins: 0,
        signups: 0,
        gameEnters: 0,
        uniqueGameAccountsSet: new Set<string>(),
      });
    }

    const eventRows = this.db.prepare(`
      SELECT event_type, account_id, username, occurred_at
      FROM dev_events
      WHERE occurred_at >= ?
      ORDER BY occurred_at ASC
    `).all(startUtc) as DevEventRow[];

    for (const row of eventRows) {
      const bucketTimestamp = Math.floor(row.occurred_at / DAY_MS) * DAY_MS;
      const bucket = buckets.get(bucketTimestamp);
      if (!bucket) continue;

      if (row.event_type === 'login') bucket.logins += 1;
      if (row.event_type === 'signup') bucket.signups += 1;
      if (row.event_type === 'game_enter') {
        bucket.gameEnters += 1;
        bucket.uniqueGameAccountsSet.add(String(row.account_id ?? row.username ?? 'unknown'));
      }
    }

    return Array.from(buckets.values()).map((bucket) => ({
      timestamp: bucket.timestamp,
      label: bucket.label,
      logins: bucket.logins,
      signups: bucket.signups,
      gameEnters: bucket.gameEnters,
      uniqueGameAccounts: bucket.uniqueGameAccountsSet.size,
    }));
  }

  private getGameRuntimeStats(now: number): DevGameRuntimeStats {
    const offlineGames = this.getOfflineGameRuntimeRows();
    const fallback: DevGameRuntimeStats = {
      online: false,
      activeConnections: 0,
      activeAccounts: [],
      serverStartedAt: null,
      lastHeartbeatAt: null,
      gameYear: null,
      paused: false,
      speedMultiplier: 0,
      starCount: 0,
      factionCount: 0,
      fleetCount: 0,
      shipCount: 0,
      starbaseCount: 0,
      planetCount: 0,
      habitedPlanetCount: 0,
      combatContactCount: 0,
      gameCount: offlineGames.length,
      games: offlineGames,
    };

    const row = this.db.prepare(`
      SELECT value, updated_at
      FROM game_runtime_stats
      WHERE key = 'game'
    `).get() as { value: string; updated_at: number } | undefined;

    if (!row) return fallback;

    try {
      const parsed = JSON.parse(row.value) as Partial<DevGameRuntimeStats>;
      const lastHeartbeatAt = Number(parsed.lastHeartbeatAt ?? row.updated_at) || row.updated_at;
      const games = this.mergeGameRuntimeRows(
        Array.isArray(parsed.games) ? parsed.games as DevGameRuntimeRow[] : [],
        now,
      );
      return {
        ...fallback,
        ...parsed,
        activeConnections: Number(parsed.activeConnections ?? 0),
        activeAccounts: Array.isArray(parsed.activeAccounts) ? parsed.activeAccounts : [],
        serverStartedAt: parsed.serverStartedAt ?? null,
        lastHeartbeatAt,
        gameYear: parsed.gameYear ?? null,
        paused: parsed.paused === true,
        speedMultiplier: Number(parsed.speedMultiplier ?? 0),
        starCount: Number(parsed.starCount ?? 0),
        factionCount: Number(parsed.factionCount ?? 0),
        fleetCount: Number(parsed.fleetCount ?? 0),
        shipCount: Number(parsed.shipCount ?? 0),
        starbaseCount: Number(parsed.starbaseCount ?? 0),
        planetCount: Number(parsed.planetCount ?? 0),
        habitedPlanetCount: Number(parsed.habitedPlanetCount ?? 0),
        combatContactCount: Number(parsed.combatContactCount ?? 0),
        gameCount: games.length,
        games,
        online: now - lastHeartbeatAt <= GAME_RUNTIME_STALE_MS,
      };
    } catch {
      return fallback;
    }
  }

  private toAccount(row: AccountRow): AuthAccount {
    return {
      id: row.id,
      username: row.username,
      accountType: row.account_type,
      factionId: row.faction_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toGame(row: GameRow): StoredGame {
    return {
      id: row.id,
      name: row.name,
      seed: row.seed,
      countryCapacity: row.country_capacity,
      createdAt: row.created_at,
    };
  }

  private toMembership(row: MembershipRow): GameMembership {
    return {
      gameId: row.game_id,
      accountId: row.account_id,
      factionId: row.faction_id,
      countryName: row.country_name,
      flagDesign: parseStoredFlagDesign(row.flag_design),
      joinedAt: row.joined_at,
    };
  }

  private toGameSummary(row: GameSummaryRow, account: AuthAccount): GameSummary {
    const game = this.toGame(row);
    const membership = row.faction_id === null || !row.country_name || row.joined_at === null
      ? null
      : this.toMembership({
        game_id: row.id,
        account_id: account.id,
        faction_id: row.faction_id,
        country_name: row.country_name,
        flag_design: row.flag_design,
        joined_at: row.joined_at,
      });
    const controlledCountries = Number(row.controlled_countries ?? 0);
    const isFull = controlledCountries >= game.countryCapacity;
    const isPrivileged = this.isPrivilegedGameAccount(account);
    return {
      ...game,
      controlledCountries,
      isFull,
      isJoined: isPrivileged || membership !== null,
      joinable: isPrivileged || membership !== null || !isFull,
      lastEnteredAt: row.last_entered_at ?? null,
      membership,
    };
  }

  private getOfflineGameRuntimeRows(): DevGameRuntimeRow[] {
    const summaries = this.db.prepare(`
      SELECT
        g.*,
        COUNT(m.account_id) AS controlled_countries
      FROM games g
      LEFT JOIN game_memberships m ON m.game_id = g.id
      GROUP BY g.id
      ORDER BY g.created_at DESC, g.id ASC
    `).all() as Array<GameRow & { controlled_countries: number }>;
    return summaries.map((row) => ({
      id: row.id,
      name: row.name,
      seed: row.seed,
      countryCapacity: row.country_capacity,
      controlledCountries: Number(row.controlled_countries ?? 0),
      createdAt: row.created_at,
      online: false,
      activeConnections: 0,
      activeAccounts: [],
      gameYear: null,
      paused: false,
      speedMultiplier: 0,
      starCount: 0,
      factionCount: 0,
      fleetCount: 0,
      shipCount: 0,
      starbaseCount: 0,
      habitedPlanetCount: 0,
      lastHeartbeatAt: null,
    }));
  }

  private mergeGameRuntimeRows(runtimeRows: DevGameRuntimeRow[], now: number): DevGameRuntimeRow[] {
    const runtimeById = new Map(runtimeRows.map((game) => [game.id, game]));
    return this.getOfflineGameRuntimeRows().map((offline) => {
      const runtime = runtimeById.get(offline.id);
      if (!runtime) return offline;
      const lastHeartbeatAt = runtime.lastHeartbeatAt ?? null;
      return {
        ...offline,
        ...runtime,
        countryCapacity: offline.countryCapacity,
        controlledCountries: offline.controlledCountries,
        createdAt: offline.createdAt,
        name: offline.name,
        seed: offline.seed,
        lastHeartbeatAt,
        online: !!lastHeartbeatAt && now - lastHeartbeatAt <= GAME_RUNTIME_STALE_MS,
      };
    });
  }
}

function buildCookieAttributes(): string {
  let attrs = 'Path=/; HttpOnly; SameSite=Lax';
  
  // Add Domain for cross-subdomain sharing (production)
  if (process.env.COOKIE_DOMAIN) {
    attrs += `; Domain=${process.env.COOKIE_DOMAIN}`;
  }
  
  // Add Secure flag for HTTPS (production)
  if (process.env.COOKIE_SECURE === 'true') {
    attrs += '; Secure';
  }
  
  return attrs;
}

export function serializeSessionCookie(token: string): string {
  const attrs = buildCookieAttributes();
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs}; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie(): string {
  const attrs = buildCookieAttributes();
  return `${SESSION_COOKIE_NAME}=; ${attrs}; Max-Age=0`;
}

export function parseSessionTokenFromCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === SESSION_COOKIE_NAME) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return null;
}

export function serializeDevSessionCookie(token: string): string {
  const attrs = buildCookieAttributes();
  return `${DEV_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs}; Max-Age=${DEV_SESSION_TTL_MS / 1000}`;
}

export function clearDevSessionCookie(): string {
  const attrs = buildCookieAttributes();
  return `${DEV_SESSION_COOKIE_NAME}=; ${attrs}; Max-Age=0`;
}

export function parseDevSessionTokenFromCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === DEV_SESSION_COOKIE_NAME) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return null;
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export const authStore = new AuthStore();
