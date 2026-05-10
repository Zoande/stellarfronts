import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, pbkdf2Sync, timingSafeEqual, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { buildFactions } from '../src/data/Factions';
import { GALAXY_MAP } from '../src/data/GalaxyMap';
import { generateStarMap } from '../src/data/StarMap';
import type { GalaxyPerspective } from '../src/data/Factions';
import type { AuthAccount, AccountType, Credentials } from '../src/auth/types';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_DIGEST = 'sha512';

type DatabaseInstance = InstanceType<typeof Database>;

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

class AuthError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
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
      accountType: 'seeded-faction' as const,
      factionId: faction.id,
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
    `);

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
  }

  getReservedUsernames(): Set<string> {
    return new Set(buildSeedAccounts().map((account) => normalizeUsername(account.username)));
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

    return this.createSessionForAccount(accountRow);
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

  private createSessionForAccount(accountRow: AccountRow): { account: AuthAccount; token: string } {
    const account = this.toAccount(accountRow);
    const token = this.createSession(account.id);
    return { account, token };
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
}

export function getPerspectiveFromAccount(account: AuthAccount): GalaxyPerspective {
  if (account.accountType === 'seeded-faction' && account.factionId !== null) {
    return { mode: 'faction', factionId: account.factionId };
  }

  return { mode: 'observer' };
}

export function serializeSessionCookie(token: string): string {
  return `sf_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie(): string {
  return 'sf_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export function parseSessionTokenFromCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === 'sf_session') {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return null;
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export const authStore = new AuthStore();