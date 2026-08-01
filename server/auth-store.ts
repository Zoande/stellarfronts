import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, pbkdf2Sync, timingSafeEqual, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { STATE_ROOT } from './game-state-path';
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
import {
  isSpeciesArchetypeId,
  normalizeSpeciesSetup,
  validateSpeciesTraits,
} from '../src/data/Species';
import type { SpeciesSetup } from '../src/data/Species';
import type {
  AuthAccount,
  AccountType,
  AchievementInfo,
  ClaimQuestResponse,
  Credentials,
  DevGameRuntimeRow,
  DevGameRuntimeStats,
  DevStatsResponse,
  GameMembership,
  GameSummary,
  NewsComment,
  NewsCommentVote,
  NewsContentBlock,
  NewsPost,
  NewsPostListItem,
  NewsPostMutationPayload,
  NewsPostStatus,
  DirectMessage,
  DirectConversation,
  PlayerProfile,
  QuestInfo,
} from '../src/auth/types';
import {
  ACHIEVEMENTS,
  GAME_XP_CAPS,
  GAME_XP_RATES,
  LEVELS,
  TRIDAY_QUESTS,
  WEEKLY_QUESTS,
  getActiveQuestIds,
  getLevelDef,
  getLevelForXp,
  getTridayWindowIndex,
  getTridayWindowKey,
  getWeeklyWindowIndex,
  getWeeklyWindowKey,
  getWindowResetTime,
  getXpProgress,
  type ProgressionStats,
} from './game/progression';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEV_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEV_ACTIVITY_SERIES_DAYS = 14;
const GAME_RUNTIME_STALE_MS = 20_000;
const ADMIN_USERNAME = 'admin';
const SESSION_COOKIE_NAME = 'sf_session';
const DEV_SESSION_COOKIE_NAME = 'sf_dev_session';
// Keep production password work intentionally expensive while allowing the
// isolated test databases to seed accounts quickly. Both guards are required
// so one accidentally-set environment variable cannot weaken a live service.
const PASSWORD_ITERATIONS = process.env.NODE_ENV === "test"
  && process.env.SF_TEST_FAST_PASSWORDS === "1"
  ? 1_000
  : 210_000;
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
  version_id?: string | null;
  status?: string | null;
  schema_version?: number | null;
  protocol_version?: number | null;
}

interface GameVersionRow {
  id: string;
  git_ref: string;
  commit_sha: string | null;
  ref_type: string | null;
  worktree_path: string;
  port: number;
  protocol_version: number;
  schema_version: number;
  migrates_from_schema: string;
  created_at: number;
}

interface GameSummaryRow extends GameRow {
  controlled_countries: number;
  faction_id: number | null;
  country_name: string | null;
  flag_design: string | null;
  species_setup: string | null;
  joined_at: number | null;
  last_entered_at: number | null;
}

interface MembershipRow {
  game_id: string;
  account_id: number;
  faction_id: number;
  country_name: string;
  flag_design: string | null;
  species_setup: string | null;
  joined_at: number;
}

interface NewsPostRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  cover_image_url: string | null;
  blocks: string;
  status: NewsPostStatus;
  author_account_id: number;
  author_username: string;
  created_at: number;
  updated_at: number;
  published_at: number | null;
  comment_count: number;
}

interface NewsCommentRow {
  id: number;
  post_id: string;
  account_id: number;
  author_username: string;
  body: string;
  created_at: number;
  updated_at: number;
  score: number;
  user_vote: NewsCommentVote | null;
}

export type GameLifecycleStatus = "active" | "stopped" | "archived";

export interface StoredGame {
  id: string;
  name: string;
  seed: number;
  countryCapacity: number;
  createdAt: number;
  /** Code version (orchestrator-managed git worktree) hosting this game. */
  versionId: string;
  status: GameLifecycleStatus;
  /** Last-seen state schema / wire protocol the game reported. */
  schemaVersion: number | null;
  protocolVersion: number | null;
}

/** What kind of git ref a version was resolved from when it was registered. */
export type GameVersionRefType = "tag" | "branch" | "commit";

export interface StoredGameVersion {
  id: string;
  /** The ref the operator selected (branch name, tag, or raw SHA). */
  gitRef: string;
  /** The exact commit SHA this version is pinned to (resolved at registration). */
  commit: string;
  /** How `gitRef` was interpreted when the version was registered. */
  refType: GameVersionRefType;
  worktreePath: string;
  port: number;
  protocolVersion: number;
  schemaVersion: number;
  migratesFromSchema: number[];
  createdAt: number;
}

export const DEFAULT_VERSION_ID = "dev";

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

function sanitizeSpeciesSetupInput(input: unknown, fallbackName: string): SpeciesSetup {
  if (!isRecord(input)) {
    return normalizeSpeciesSetup(undefined, fallbackName);
  }
  if (!isSpeciesArchetypeId(input.archetypeId)) {
    throw new AuthError('Invalid species archetype', 400);
  }
  const validation = validateSpeciesTraits(Array.isArray(input.traitIds) ? input.traitIds : []);
  if (!validation.valid) {
    throw new AuthError(validation.errors[0] ?? 'Invalid species traits', 400);
  }
  return {
    ...normalizeSpeciesSetup(input, fallbackName),
    traitIds: validation.normalizedTraitIds,
  };
}

function parseStoredSpeciesSetup(value: string | null): SpeciesSetup | null {
  if (!value) return null;
  try {
    return normalizeSpeciesSetup(JSON.parse(value));
  } catch {
    return null;
  }
}

function sanitizePlainText(value: unknown, fieldName: string, maxLength: number, required = true): string {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return '';
    throw new AuthError(`${fieldName} is required`, 400);
  }
  const text = value.trim();
  if (required && !text) {
    throw new AuthError(`${fieldName} is required`, 400);
  }
  if (text.length > maxLength) {
    throw new AuthError(`${fieldName} must be ${maxLength} characters or fewer`, 400);
  }
  return text;
}

function sanitizeImageUrl(value: unknown, fieldName = 'Image URL', required = true): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AuthError(`${fieldName} is required`, 400);
    return null;
  }
  if (typeof value !== 'string') {
    throw new AuthError(`${fieldName} must be a URL`, 400);
  }
  const url = value.trim();
  if (!url) {
    if (required) throw new AuthError(`${fieldName} is required`, 400);
    return null;
  }
  if (url.length > 2048) {
    throw new AuthError(`${fieldName} must be 2048 characters or fewer`, 400);
  }
  if (url.startsWith('/') && !url.startsWith('//')) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url;
    }
  } catch {
    // Fall through to the shared error below.
  }
  throw new AuthError(`${fieldName} must be an http, https, or site-relative URL`, 400);
}

function sanitizeNewsPostStatus(value: unknown): NewsPostStatus {
  if (value === undefined || value === null || value === '') return 'draft';
  if (value === 'draft' || value === 'published') return value;
  throw new AuthError('Invalid news post status', 400);
}

function sanitizeNewsBlockId(value: unknown): string {
  if (typeof value === 'string' && /^[a-z0-9-]{4,80}$/i.test(value)) {
    return value;
  }
  return createNewsBlockId();
}

function sanitizeNewsBlocks(value: unknown): NewsContentBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }
  if (value.length > 80) {
    throw new AuthError('News posts can contain up to 80 content blocks', 400);
  }

  return value.map((blockInput) => {
    if (!isRecord(blockInput)) {
      throw new AuthError('Invalid news content block', 400);
    }

    const id = sanitizeNewsBlockId(blockInput.id);
    if (blockInput.type === 'heading') {
      return {
        id,
        type: 'heading',
        text: sanitizePlainText(blockInput.text, 'Heading text', 180, false),
      };
    }
    if (blockInput.type === 'paragraph') {
      return {
        id,
        type: 'paragraph',
        text: sanitizePlainText(blockInput.text, 'Paragraph text', 5000, false),
      };
    }
    if (blockInput.type === 'image') {
      return {
        id,
        type: 'image',
        imageUrl: sanitizeImageUrl(blockInput.imageUrl, 'Image URL', true) ?? '',
        altText: sanitizePlainText(blockInput.altText, 'Image alt text', 180, false),
        caption: sanitizePlainText(blockInput.caption, 'Image caption', 280, false),
      };
    }

    throw new AuthError('Unsupported news content block type', 400);
  });
}

function newsBlockHasContent(block: NewsContentBlock): boolean {
  if (block.type === 'image') return !!block.imageUrl;
  return block.text.trim().length > 0;
}

function sanitizeNewsPostPayload(value: unknown): NewsPostMutationPayload {
  if (!isRecord(value)) {
    throw new AuthError('News post payload is required', 400);
  }

  const status = sanitizeNewsPostStatus(value.status);
  const payload: NewsPostMutationPayload = {
    title: sanitizePlainText(value.title, 'Title', 140),
    summary: sanitizePlainText(value.summary, 'Summary', 420, false),
    coverImageUrl: sanitizeImageUrl(value.coverImageUrl, 'Cover image URL', false),
    blocks: sanitizeNewsBlocks(value.blocks),
    status,
  };

  if (status === 'published' && !payload.summary) {
    throw new AuthError('Summary is required to publish a post', 400);
  }

  if (status === 'published' && !payload.blocks.some(newsBlockHasContent)) {
    throw new AuthError('Published news posts need at least one content block', 400);
  }

  return payload;
}

function sanitizeNewsCommentBody(value: unknown): string {
  return sanitizePlainText(value, 'Comment', 1200);
}

function sanitizeNewsVote(value: unknown): NewsCommentVote {
  if (value === -1 || value === 0 || value === 1) return value;
  throw new AuthError('Vote must be -1, 0, or 1', 400);
}

function slugifyNewsTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/g, '');
  return slug || 'news-post';
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

function createNewsPostId(): string {
  return randomBytes(12).toString('hex');
}

function createNewsBlockId(): string {
  return randomBytes(8).toString('hex');
}

function createGameSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

function getDevPanelPassword(): string {
  const password = process.env.DEV_PANEL_PASSWORD;
  if (!password) {
    throw new Error('DEV_PANEL_PASSWORD environment variable is required');
  }
  return password;
}

function getAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error('ADMIN_PASSWORD environment variable is required');
  }
  return password;
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
  private readonly adminPassword: string;
  private readonly devPanelPassword: string;

  constructor(dbPath = path.join(STATE_ROOT, 'auth.sqlite')) {
    this.adminPassword = getAdminPassword();
    this.devPanelPassword = getDevPanelPassword();
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    // Several processes share this catalog (auth + orchestrator + each version's
    // game server). Wait out brief write contention instead of throwing SQLITE_BUSY.
    this.db.pragma('busy_timeout = 5000');
    // Version game processes use the stable catalog but must never run control-
    // plane DDL, migrations, or seed mutations from historical code.
    if (process.env.SF_AUTH_STORE_MODE !== 'runtime') {
      this.initialize();
    }
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

      CREATE TABLE IF NOT EXISTS game_versions (
        id TEXT PRIMARY KEY,
        git_ref TEXT NOT NULL,
        commit_sha TEXT,
        ref_type TEXT,
        worktree_path TEXT NOT NULL,
        port INTEGER NOT NULL,
        protocol_version INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        migrates_from_schema TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS game_memberships (
        game_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        faction_id INTEGER NOT NULL,
        country_name TEXT NOT NULL,
        flag_design TEXT,
        species_setup TEXT,
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

      CREATE TABLE IF NOT EXISTS news_posts (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        cover_image_url TEXT,
        blocks TEXT NOT NULL,
        status TEXT NOT NULL,
        author_account_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        published_at INTEGER,
        FOREIGN KEY(author_account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS news_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(post_id) REFERENCES news_posts(id) ON DELETE CASCADE,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS news_comment_votes (
        comment_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        vote INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(comment_id, account_id),
        FOREIGN KEY(comment_id) REFERENCES news_comments(id) ON DELETE CASCADE,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS player_progression (
        account_id INTEGER PRIMARY KEY,
        total_xp INTEGER NOT NULL DEFAULT 0,
        dark_matter INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS player_stats (
        account_id INTEGER PRIMARY KEY,
        comment_count INTEGER NOT NULL DEFAULT 0,
        vote_count INTEGER NOT NULL DEFAULT 0,
        upvote_count INTEGER NOT NULL DEFAULT 0,
        downvote_count INTEGER NOT NULL DEFAULT 0,
        quests_claimed INTEGER NOT NULL DEFAULT 0,
        game_damage_dealt REAL NOT NULL DEFAULT 0,
        game_profit_earned REAL NOT NULL DEFAULT 0,
        game_stability_ticks INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS player_achievements (
        account_id INTEGER NOT NULL,
        achievement_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL,
        PRIMARY KEY(account_id, achievement_id),
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS player_quests (
        account_id INTEGER NOT NULL,
        quest_id TEXT NOT NULL,
        window_key TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        completed_at INTEGER,
        claimed_at INTEGER,
        PRIMARY KEY(account_id, quest_id, window_key),
        FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_dev_sessions_expires_at ON dev_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_dev_events_type_time ON dev_events(event_type, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_dev_events_account_id ON dev_events(account_id);
      CREATE INDEX IF NOT EXISTS idx_game_memberships_account_id ON game_memberships(account_id);
      CREATE INDEX IF NOT EXISTS idx_game_visits_account_id ON game_visits(account_id, last_entered_at);
      CREATE INDEX IF NOT EXISTS idx_news_posts_status_time ON news_posts(status, published_at, updated_at);
      CREATE INDEX IF NOT EXISTS idx_news_comments_post_time ON news_comments(post_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_news_votes_comment ON news_comment_votes(comment_id);
      CREATE INDEX IF NOT EXISTS idx_player_achievements_account ON player_achievements(account_id);
      CREATE INDEX IF NOT EXISTS idx_player_quests_account ON player_quests(account_id, window_key);

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        recipient_id INTEGER NOT NULL,
        body TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        read_at INTEGER,
        FOREIGN KEY(sender_id) REFERENCES accounts(id) ON DELETE CASCADE,
        FOREIGN KEY(recipient_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, recipient_id, sent_at);
      CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, read_at);
    `);

    const membershipColumns = this.db.prepare(`PRAGMA table_info(game_memberships)`).all() as Array<{ name: string }>;
    if (!membershipColumns.some((column) => column.name === 'flag_design')) {
      this.db.exec(`ALTER TABLE game_memberships ADD COLUMN flag_design TEXT`);
    }
    if (!membershipColumns.some((column) => column.name === 'species_setup')) {
      this.db.exec(`ALTER TABLE game_memberships ADD COLUMN species_setup TEXT`);
    }

    const gameColumns = this.db.prepare(`PRAGMA table_info(games)`).all() as Array<{ name: string }>;
    if (!gameColumns.some((column) => column.name === 'version_id')) {
      this.db.exec(`ALTER TABLE games ADD COLUMN version_id TEXT NOT NULL DEFAULT 'dev'`);
    }
    if (!gameColumns.some((column) => column.name === 'status')) {
      this.db.exec(`ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
    }
    if (!gameColumns.some((column) => column.name === 'schema_version')) {
      this.db.exec(`ALTER TABLE games ADD COLUMN schema_version INTEGER`);
    }
    if (!gameColumns.some((column) => column.name === 'protocol_version')) {
      this.db.exec(`ALTER TABLE games ADD COLUMN protocol_version INTEGER`);
    }

    const versionColumns = this.db.prepare(`PRAGMA table_info(game_versions)`).all() as Array<{ name: string }>;
    if (!versionColumns.some((column) => column.name === 'commit_sha')) {
      this.db.exec(`ALTER TABLE game_versions ADD COLUMN commit_sha TEXT`);
    }
    if (!versionColumns.some((column) => column.name === 'ref_type')) {
      this.db.exec(`ALTER TABLE game_versions ADD COLUMN ref_type TEXT`);
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

  createGame(nameInput: string, versionId: string = DEFAULT_VERSION_ID): StoredGame {
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
    if (versionId !== DEFAULT_VERSION_ID && !this.getGameVersion(versionId)) {
      throw new AuthError('Unknown game version', 400);
    }

    const createdAt = Date.now();
    const game: StoredGame = {
      id: createGameId(),
      name,
      seed: createGameSeed(),
      countryCapacity: FACTION_COUNT,
      createdAt,
      versionId,
      status: 'active',
      schemaVersion: null,
      protocolVersion: null,
    };
    this.db.prepare(`
      INSERT INTO games (id, name, seed, country_capacity, created_at, version_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(game.id, game.name, game.seed, game.countryCapacity, game.createdAt, game.versionId, game.status);
    return game;
  }

  setGameVersion(gameId: string, versionId: string): StoredGame | null {
    const game = this.getGameById(gameId);
    if (!game) return null;
    this.db.prepare(`UPDATE games SET version_id = ? WHERE id = ?`).run(versionId, gameId);
    return this.getGameById(gameId);
  }

  setGameStatus(gameId: string, status: GameLifecycleStatus): StoredGame | null {
    const game = this.getGameById(gameId);
    if (!game) return null;
    this.db.prepare(`UPDATE games SET status = ? WHERE id = ?`).run(status, gameId);
    return this.getGameById(gameId);
  }

  recordGameStateVersions(gameId: string, schemaVersion: number, protocolVersion: number): void {
    this.db.prepare(`UPDATE games SET schema_version = ?, protocol_version = ? WHERE id = ?`)
      .run(schemaVersion, protocolVersion, gameId);
  }

  clearGameStateVersions(gameId: string): void {
    this.db.prepare(`UPDATE games SET schema_version = NULL, protocol_version = NULL WHERE id = ?`)
      .run(gameId);
  }

  listGamesByVersion(versionId: string): StoredGame[] {
    const rows = this.db.prepare(`SELECT * FROM games WHERE version_id = ? ORDER BY created_at DESC, id ASC`).all(versionId) as GameRow[];
    return rows.map((row) => this.toGame(row));
  }

  registerGameVersion(version: StoredGameVersion): StoredGameVersion {
    this.db.prepare(`
      INSERT INTO game_versions (id, git_ref, commit_sha, ref_type, worktree_path, port, protocol_version, schema_version, migrates_from_schema, created_at)
      VALUES (@id, @gitRef, @commit, @refType, @worktreePath, @port, @protocolVersion, @schemaVersion, @migratesFromSchema, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        git_ref = excluded.git_ref,
        commit_sha = excluded.commit_sha,
        ref_type = excluded.ref_type,
        worktree_path = excluded.worktree_path,
        port = excluded.port,
        protocol_version = excluded.protocol_version,
        schema_version = excluded.schema_version,
        migrates_from_schema = excluded.migrates_from_schema
    `).run({
      id: version.id,
      gitRef: version.gitRef,
      commit: version.commit,
      refType: version.refType,
      worktreePath: version.worktreePath,
      port: version.port,
      protocolVersion: version.protocolVersion,
      schemaVersion: version.schemaVersion,
      migratesFromSchema: JSON.stringify(version.migratesFromSchema),
      createdAt: version.createdAt,
    });
    return version;
  }

  getGameVersion(versionId: string): StoredGameVersion | null {
    const row = this.db.prepare(`SELECT * FROM game_versions WHERE id = ?`).get(versionId) as GameVersionRow | undefined;
    return row ? this.toGameVersion(row) : null;
  }

  listGameVersions(): StoredGameVersion[] {
    const rows = this.db.prepare(`SELECT * FROM game_versions ORDER BY created_at ASC, id ASC`).all() as GameVersionRow[];
    return rows.map((row) => this.toGameVersion(row));
  }

  removeGameVersion(versionId: string): boolean {
    const result = this.db.prepare(`DELETE FROM game_versions WHERE id = ?`).run(versionId);
    // Drop the retired process's heartbeat row so it never lingers in dev stats.
    this.db.prepare(`DELETE FROM game_runtime_stats WHERE key = ?`).run(`game:${versionId}`);
    return result.changes > 0;
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
        own_members.species_setup,
        own_members.joined_at,
        visits.last_entered_at
      FROM games g
      LEFT JOIN game_memberships all_members ON all_members.game_id = g.id
      LEFT JOIN game_memberships own_members ON own_members.game_id = g.id AND own_members.account_id = ?
      LEFT JOIN game_visits visits ON visits.game_id = g.id AND visits.account_id = ?
      WHERE g.status != 'archived'
      GROUP BY g.id, own_members.faction_id, own_members.country_name, own_members.flag_design, own_members.species_setup, own_members.joined_at, visits.last_entered_at
      ORDER BY COALESCE(visits.last_entered_at, 0) DESC, g.created_at DESC, g.id ASC
    `).all(account.id, account.id) as GameSummaryRow[];
    const runtimeById = new Map(
      this.getGameRuntimeStats(Date.now()).games.map((runtime) => [runtime.id, runtime]),
    );
    return rows.map((row) => this.toGameSummary(row, account, runtimeById.get(row.id)));
  }

  getGameSummaryForAccount(gameId: string, account: AuthAccount): GameSummary | null {
    return this.getGameSummariesForAccount(account).find((game) => game.id === gameId) ?? null;
  }

  getGameMembership(gameId: string, accountId: number): GameMembership | null {
    const row = this.db.prepare(`
      SELECT game_id, account_id, faction_id, country_name, flag_design, species_setup, joined_at
      FROM game_memberships
      WHERE game_id = ? AND account_id = ?
    `).get(gameId, accountId) as MembershipRow | undefined;
    return row ? this.toMembership(row) : null;
  }

  listGameMemberships(gameId: string): GameMembership[] {
    const rows = this.db.prepare(`
      SELECT game_id, account_id, faction_id, country_name, flag_design, species_setup, joined_at
      FROM game_memberships
      WHERE game_id = ?
      ORDER BY faction_id ASC
    `).all(gameId) as MembershipRow[];
    return rows.map((row) => this.toMembership(row));
  }

  joinGame(
    account: AuthAccount,
    gameId: string,
    countryNameInput: string,
    flagDesignInput?: unknown,
    speciesSetupInput?: unknown,
  ): GameMembership | null {
    if (this.isPrivilegedGameAccount(account)) {
      const game = this.getGameById(gameId);
      if (!game || game.status === 'archived') throw new AuthError('Game not found', 404);
      if (game.status !== 'active') throw new AuthError('Game is not currently available', 409);
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
      if (!game || game.status === 'archived') throw new AuthError('Game not found', 404);
      if (game.status !== 'active') throw new AuthError('Game is not currently available', 409);
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
      const speciesSetup = sanitizeSpeciesSetupInput(speciesSetupInput, `${countryName} Founders`);
      this.db.prepare(`
        INSERT INTO game_memberships (game_id, account_id, faction_id, country_name, flag_design, species_setup, joined_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(game.id, account.id, factionId, countryName, JSON.stringify(flagDesign), JSON.stringify(speciesSetup), joinedAt);
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

  listNewsPosts(options?: { includeDrafts?: boolean }): NewsPostListItem[] {
    const includeDrafts = options?.includeDrafts === true;
    const rows = this.db.prepare(`
      SELECT
        p.*,
        a.username AS author_username,
        COUNT(c.id) AS comment_count
      FROM news_posts p
      JOIN accounts a ON a.id = p.author_account_id
      LEFT JOIN news_comments c ON c.post_id = p.id
      ${includeDrafts ? '' : `WHERE p.status = 'published'`}
      GROUP BY p.id
      ORDER BY COALESCE(p.published_at, p.updated_at) DESC, p.created_at DESC
    `).all() as NewsPostRow[];
    return rows.map((row) => this.toNewsPostListItem(row));
  }

  getNewsPostBySlug(
    slugInput: string,
    viewer: AuthAccount | null = null,
    options?: { includeDrafts?: boolean },
  ): NewsPost | null {
    const row = this.getNewsPostRowBySlug(slugInput, options?.includeDrafts === true);
    if (!row) return null;
    return this.toNewsPost(row, viewer);
  }

  getNewsPostById(
    postId: string,
    viewer: AuthAccount | null = null,
    options?: { includeDrafts?: boolean },
  ): NewsPost | null {
    const row = this.getNewsPostRowById(postId, options?.includeDrafts === true);
    if (!row) return null;
    return this.toNewsPost(row, viewer);
  }

  createNewsPost(account: AuthAccount, payloadInput: unknown): NewsPost {
    this.assertNewsAdmin(account);
    const payload = sanitizeNewsPostPayload(payloadInput);
    const now = Date.now();
    const id = createNewsPostId();
    const slug = this.createUniqueNewsSlug(payload.title);
    const publishedAt = payload.status === 'published' ? now : null;

    this.db.prepare(`
      INSERT INTO news_posts (
        id,
        slug,
        title,
        summary,
        cover_image_url,
        blocks,
        status,
        author_account_id,
        created_at,
        updated_at,
        published_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      slug,
      payload.title,
      payload.summary,
      payload.coverImageUrl ?? null,
      JSON.stringify(payload.blocks),
      payload.status ?? 'draft',
      account.id,
      now,
      now,
      publishedAt,
    );

    const post = this.getNewsPostById(id, account, { includeDrafts: true });
    if (!post) throw new AuthError('Could not create news post', 500);
    return post;
  }

  updateNewsPost(account: AuthAccount, postId: string, payloadInput: unknown): NewsPost {
    this.assertNewsAdmin(account);
    const current = this.getNewsPostRowById(postId, true);
    if (!current) throw new AuthError('News post not found', 404);

    const payload = sanitizeNewsPostPayload(payloadInput);
    const now = Date.now();
    const nextStatus = payload.status ?? 'draft';
    const publishedAt = nextStatus === 'published'
      ? current.published_at ?? now
      : null;

    this.db.prepare(`
      UPDATE news_posts
      SET
        title = ?,
        summary = ?,
        cover_image_url = ?,
        blocks = ?,
        status = ?,
        updated_at = ?,
        published_at = ?
      WHERE id = ?
    `).run(
      payload.title,
      payload.summary,
      payload.coverImageUrl ?? null,
      JSON.stringify(payload.blocks),
      nextStatus,
      now,
      publishedAt,
      current.id,
    );

    const post = this.getNewsPostById(current.id, account, { includeDrafts: true });
    if (!post) throw new AuthError('Could not update news post', 500);
    return post;
  }

  deleteNewsPost(account: AuthAccount, postId: string): NewsPostListItem | null {
    this.assertNewsAdmin(account);
    const current = this.getNewsPostRowById(postId, true);
    if (!current) return null;
    this.db.prepare(`DELETE FROM news_posts WHERE id = ?`).run(current.id);
    return this.toNewsPostListItem(current);
  }

  createNewsComment(account: AuthAccount, slugInput: string, bodyInput: unknown): NewsComment {
    const post = this.getNewsPostRowBySlug(slugInput, false);
    if (!post) throw new AuthError('News post not found', 404);

    const body = sanitizeNewsCommentBody(bodyInput);
    const now = Date.now();
    const result = this.db.prepare(`
      INSERT INTO news_comments (post_id, account_id, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(post.id, account.id, body, now, now);

    const comment = this.getNewsCommentById(Number(result.lastInsertRowid), account.id);
    if (!comment) throw new AuthError('Could not create comment', 500);
    return comment;
  }

  voteNewsComment(account: AuthAccount, commentId: number, voteInput: unknown): NewsComment {
    const vote = sanitizeNewsVote(voteInput);
    const current = this.getNewsCommentById(commentId, account.id);
    if (!current) throw new AuthError('Comment not found', 404);

    const post = this.getNewsPostRowById(current.postId, false);
    if (!post) throw new AuthError('Comment not found', 404);

    if (vote === 0) {
      this.db.prepare(`
        DELETE FROM news_comment_votes
        WHERE comment_id = ? AND account_id = ?
      `).run(current.id, account.id);
    } else {
      const now = Date.now();
      this.db.prepare(`
        INSERT INTO news_comment_votes (comment_id, account_id, vote, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(comment_id, account_id) DO UPDATE SET
          vote = excluded.vote,
          updated_at = excluded.updated_at
      `).run(current.id, account.id, vote, now, now);
    }

    const comment = this.getNewsCommentById(current.id, account.id);
    if (!comment) throw new AuthError('Could not update vote', 500);
    return comment;
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
      throw new AuthError('Account not found', 404);
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
    return safeStringEquals(password, this.devPanelPassword);
  }

  getAccountIdForGameFaction(gameId: string, factionId: number): number | null {
    const row = this.db.prepare(`
      SELECT account_id
      FROM game_memberships
      WHERE game_id = ? AND faction_id = ?
    `).get(gameId, factionId) as { account_id: number } | undefined;
    return row?.account_id ?? null;
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
    // One row PER version process (key "game:<versionId>"). Every registered
    // version runs as its own game-server process and publishes the games it
    // hosts; a single shared "game" row would let them clobber each other (last
    // writer wins, every other version's games falsely appear offline). The dev
    // stats reader fans these rows back together. Falls back to "dev" for the
    // working-tree process. See getGameRuntimeStats for the merge.
    const versionId = process.env.SF_VERSION_ID ?? 'dev';
    this.db.prepare(`
      INSERT INTO game_runtime_stats (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(`game:${versionId}`, JSON.stringify(runtimeStats), now);
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
      hashPassword(this.adminPassword, salt),
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
      processes: [],
      failures: [],
    };

    // Gather every version process's heartbeat row (key "game:<versionId>") and
    // keep only the fresh ones. A crashed/retired process's row simply ages out
    // past GAME_RUNTIME_STALE_MS and stops counting toward "online".
    const rows = this.db.prepare(`
      SELECT value, updated_at
      FROM game_runtime_stats
      WHERE key LIKE 'game:%'
    `).all() as Array<{ value: string; updated_at: number }>;

    const freshProcesses: Array<{ stats: Partial<DevGameRuntimeStats>; heartbeat: number }> = [];
    for (const row of rows) {
      try {
        const stats = JSON.parse(row.value) as Partial<DevGameRuntimeStats>;
        const heartbeat = Number(stats.lastHeartbeatAt ?? row.updated_at) || row.updated_at;
        if (now - heartbeat > GAME_RUNTIME_STALE_MS) continue;
        freshProcesses.push({ stats, heartbeat });
      } catch {
        // Skip an unparseable row rather than blanking the whole view.
      }
    }

    if (freshProcesses.length === 0) return fallback;

    // Collapse the per-game rows reported across all live processes, newest
    // heartbeat winning if a game id somehow appears twice (it shouldn't — each
    // game is hosted by exactly one version at a time).
    const runtimeById = new Map<string, DevGameRuntimeRow>();
    const processHealth = freshProcesses.flatMap(({ stats }) => Array.isArray(stats.processes) ? stats.processes : []);
    const failures = freshProcesses.flatMap(({ stats }) => Array.isArray(stats.failures) ? stats.failures : []);
    for (const { stats } of freshProcesses) {
      if (!Array.isArray(stats.games)) continue;
      for (const game of stats.games as DevGameRuntimeRow[]) {
        const existing = runtimeById.get(game.id);
        if (!existing || (game.lastHeartbeatAt ?? 0) >= (existing.lastHeartbeatAt ?? 0)) {
          runtimeById.set(game.id, game);
        }
      }
    }

    // Overlay onto the full catalog so unhosted games still show as offline, then
    // recompute the top-level aggregate FROM the merged online games — this stays
    // correct no matter how many version processes are reporting.
    const failureByGameId = new Map(failures.map((failure) => [failure.gameId, failure]));
    const games = this.mergeGameRuntimeRows(Array.from(runtimeById.values()), now).map((game) => {
      const failure = failureByGameId.get(game.id);
      return failure ? {
        ...game,
        versionId: failure.versionId,
        health: 'failed' as const,
        error: failure.message,
      } : game;
    });
    const onlineGames = games.filter((game) => game.online);
    const activeAccounts = Array.from(new Set(onlineGames.flatMap((game) => game.activeAccounts)))
      .sort((a, b) => a.localeCompare(b));
    const sum = (pick: (game: DevGameRuntimeRow) => number): number =>
      onlineGames.reduce((total, game) => total + (Number(pick(game)) || 0), 0);
    const serverStartedAt = freshProcesses
      .map((process) => process.stats.serverStartedAt)
      .filter((value): value is number => typeof value === 'number')
      .reduce<number | null>((earliest, value) => (earliest === null ? value : Math.min(earliest, value)), null);

    return {
      ...fallback,
      online: true,
      activeConnections: sum((game) => game.activeConnections),
      activeAccounts,
      serverStartedAt,
      lastHeartbeatAt: Math.max(...freshProcesses.map((process) => process.heartbeat)),
      // Single-game scalars stay meaningful only when exactly one game is live.
      gameYear: onlineGames.length === 1 ? onlineGames[0].gameYear : null,
      paused: onlineGames.length > 0 && onlineGames.every((game) => game.paused),
      speedMultiplier: onlineGames.length === 1 ? onlineGames[0].speedMultiplier : 0,
      starCount: sum((game) => game.starCount),
      factionCount: sum((game) => game.factionCount),
      fleetCount: sum((game) => game.fleetCount),
      shipCount: sum((game) => game.shipCount),
      starbaseCount: sum((game) => game.starbaseCount),
      habitedPlanetCount: sum((game) => game.habitedPlanetCount),
      gameCount: games.length,
      games,
      processes: processHealth,
      failures,
    };
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
      versionId: row.version_id ?? DEFAULT_VERSION_ID,
      status: (row.status as GameLifecycleStatus | undefined) ?? "active",
      schemaVersion: row.schema_version ?? null,
      protocolVersion: row.protocol_version ?? null,
    };
  }

  private toGameVersion(row: GameVersionRow): StoredGameVersion {
    let migratesFromSchema: number[] = [];
    try {
      const parsed = JSON.parse(row.migrates_from_schema);
      if (Array.isArray(parsed)) migratesFromSchema = parsed.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    } catch {
      migratesFromSchema = [];
    }
    const refType: GameVersionRefType =
      row.ref_type === "tag" || row.ref_type === "branch" || row.ref_type === "commit"
        ? row.ref_type
        : "commit";
    return {
      id: row.id,
      gitRef: row.git_ref,
      commit: row.commit_sha ?? "",
      refType,
      worktreePath: row.worktree_path,
      port: row.port,
      protocolVersion: row.protocol_version,
      schemaVersion: row.schema_version,
      migratesFromSchema,
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
      speciesSetup: parseStoredSpeciesSetup(row.species_setup),
      joinedAt: row.joined_at,
    };
  }

  private toGameSummary(
    row: GameSummaryRow,
    account: AuthAccount,
    runtime?: DevGameRuntimeRow,
  ): GameSummary {
    const game = this.toGame(row);
    const membership = row.faction_id === null || !row.country_name || row.joined_at === null
      ? null
      : this.toMembership({
        game_id: row.id,
        account_id: account.id,
        faction_id: row.faction_id,
        country_name: row.country_name,
        flag_design: row.flag_design,
        species_setup: row.species_setup,
        joined_at: row.joined_at,
      });
    const controlledCountries = Number(row.controlled_countries ?? 0);
    const isFull = controlledCountries >= game.countryCapacity;
    const isPrivileged = this.isPrivilegedGameAccount(account);
    const availability = game.status === 'stopped'
      ? 'stopped'
      : runtime?.health === 'failed'
        ? 'unavailable'
        : runtime?.health === 'loading'
          ? 'starting'
          : runtime?.online
            ? 'ready'
            : game.schemaVersion === null
              ? 'starting'
              : 'unavailable';
    return {
      id: game.id,
      name: game.name,
      seed: game.seed,
      countryCapacity: game.countryCapacity,
      createdAt: game.createdAt,
      controlledCountries,
      isFull,
      isJoined: isPrivileged || membership !== null,
      joinable: availability === 'ready' && (isPrivileged || membership !== null || !isFull),
      lastEnteredAt: row.last_entered_at ?? null,
      membership,
      availability,
    };
  }

  private assertNewsAdmin(account: AuthAccount): void {
    if (!this.isAdminAccount(account)) {
      throw new AuthError('Administrator account required', 403);
    }
  }

  private createUniqueNewsSlug(title: string): string {
    const base = slugifyNewsTitle(title);
    for (let suffix = 0; suffix < 1000; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const existing = this.db.prepare(`SELECT id FROM news_posts WHERE slug = ? COLLATE NOCASE`).get(candidate);
      if (!existing) return candidate;
    }
    return `${base}-${randomBytes(3).toString('hex')}`;
  }

  private getNewsPostRowBySlug(slugInput: string, includeDrafts: boolean): NewsPostRow | null {
    const slug = slugInput.trim().toLowerCase();
    if (!slug) return null;
    const row = this.db.prepare(`
      SELECT
        p.*,
        a.username AS author_username,
        COUNT(c.id) AS comment_count
      FROM news_posts p
      JOIN accounts a ON a.id = p.author_account_id
      LEFT JOIN news_comments c ON c.post_id = p.id
      WHERE p.slug = ? COLLATE NOCASE
        ${includeDrafts ? '' : `AND p.status = 'published'`}
      GROUP BY p.id
    `).get(slug) as NewsPostRow | undefined;
    return row ?? null;
  }

  private getNewsPostRowById(postId: string, includeDrafts: boolean): NewsPostRow | null {
    const row = this.db.prepare(`
      SELECT
        p.*,
        a.username AS author_username,
        COUNT(c.id) AS comment_count
      FROM news_posts p
      JOIN accounts a ON a.id = p.author_account_id
      LEFT JOIN news_comments c ON c.post_id = p.id
      WHERE p.id = ?
        ${includeDrafts ? '' : `AND p.status = 'published'`}
      GROUP BY p.id
    `).get(postId) as NewsPostRow | undefined;
    return row ?? null;
  }

  private getNewsCommentRowsForPost(postId: string, viewerAccountId: number | null): NewsCommentRow[] {
    return this.db.prepare(`
      SELECT
        c.id,
        c.post_id,
        c.account_id,
        a.username AS author_username,
        c.body,
        c.created_at,
        c.updated_at,
        COALESCE(SUM(all_votes.vote), 0) AS score,
        COALESCE(viewer_vote.vote, 0) AS user_vote
      FROM news_comments c
      JOIN accounts a ON a.id = c.account_id
      LEFT JOIN news_comment_votes all_votes ON all_votes.comment_id = c.id
      LEFT JOIN news_comment_votes viewer_vote
        ON viewer_vote.comment_id = c.id AND viewer_vote.account_id = ?
      WHERE c.post_id = ?
      GROUP BY c.id, viewer_vote.vote
      ORDER BY c.created_at ASC, c.id ASC
    `).all(viewerAccountId ?? -1, postId) as NewsCommentRow[];
  }

  private getNewsCommentById(commentId: number, viewerAccountId: number | null): NewsComment | null {
    const row = this.db.prepare(`
      SELECT
        c.id,
        c.post_id,
        c.account_id,
        a.username AS author_username,
        c.body,
        c.created_at,
        c.updated_at,
        COALESCE(SUM(all_votes.vote), 0) AS score,
        COALESCE(viewer_vote.vote, 0) AS user_vote
      FROM news_comments c
      JOIN accounts a ON a.id = c.account_id
      LEFT JOIN news_comment_votes all_votes ON all_votes.comment_id = c.id
      LEFT JOIN news_comment_votes viewer_vote
        ON viewer_vote.comment_id = c.id AND viewer_vote.account_id = ?
      WHERE c.id = ?
      GROUP BY c.id, viewer_vote.vote
    `).get(viewerAccountId ?? -1, commentId) as NewsCommentRow | undefined;
    return row ? this.toNewsComment(row) : null;
  }

  private parseNewsBlocks(blocks: string): NewsContentBlock[] {
    try {
      return sanitizeNewsBlocks(JSON.parse(blocks));
    } catch {
      return [];
    }
  }

  private toNewsPostListItem(row: NewsPostRow): NewsPostListItem {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      coverImageUrl: row.cover_image_url,
      status: row.status === 'published' ? 'published' : 'draft',
      author: {
        id: row.author_account_id,
        username: row.author_username,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
      commentCount: Number(row.comment_count ?? 0),
    };
  }

  private toNewsPost(row: NewsPostRow, viewer: AuthAccount | null): NewsPost {
    return {
      ...this.toNewsPostListItem(row),
      blocks: this.parseNewsBlocks(row.blocks),
      comments: this.getNewsCommentRowsForPost(row.id, viewer?.id ?? null).map((comment) => this.toNewsComment(comment)),
    };
  }

  private toNewsComment(row: NewsCommentRow): NewsComment {
    const userVote = row.user_vote === -1 || row.user_vote === 1 ? row.user_vote : 0;
    return {
      id: row.id,
      postId: row.post_id,
      author: {
        id: row.account_id,
        username: row.author_username,
      },
      body: row.body,
      score: Number(row.score ?? 0),
      userVote,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
      versionId: row.version_id ?? DEFAULT_VERSION_ID,
      health: 'offline',
      error: null,
      lastSaveAt: null,
      lastTickDurationMs: 0,
      maxTickDurationMs: 0,
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
        health: runtime.health ?? (!!lastHeartbeatAt && now - lastHeartbeatAt <= GAME_RUNTIME_STALE_MS ? 'healthy' : 'offline'),
      };
    });
  }

  // ─── Player Progression ──────────────────────────────────────────────────────

  private ensurePlayerRow(accountId: number): void {
    const now = Date.now();
    this.db.prepare(
      `INSERT OR IGNORE INTO player_progression (account_id, total_xp, dark_matter, updated_at) VALUES (?, 0, 0, ?)`,
    ).run(accountId, now);
    this.db.prepare(
      `INSERT OR IGNORE INTO player_stats (account_id, comment_count, vote_count, upvote_count, downvote_count, quests_claimed, game_damage_dealt, game_profit_earned, game_stability_ticks) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0)`,
    ).run(accountId);
  }

  private getProgressionStats(accountId: number): ProgressionStats {
    this.ensurePlayerRow(accountId);
    const stats = this.db.prepare(`SELECT * FROM player_stats WHERE account_id = ?`).get(accountId) as {
      comment_count: number; vote_count: number; upvote_count: number;
      downvote_count: number; quests_claimed: number;
      game_damage_dealt: number; game_profit_earned: number; game_stability_ticks: number;
    };
    const totalXp = (this.db.prepare(`SELECT total_xp FROM player_progression WHERE account_id = ?`).get(accountId) as { total_xp: number } | undefined)?.total_xp ?? 0;
    const gamesJoined = (this.db.prepare(`SELECT COUNT(*) AS c FROM game_memberships WHERE account_id = ?`).get(accountId) as { c: number }).c;
    const achievementCount = (this.db.prepare(`SELECT COUNT(*) AS c FROM player_achievements WHERE account_id = ?`).get(accountId) as { c: number }).c;
    return {
      commentCount: stats.comment_count,
      voteCount: stats.vote_count,
      upvoteCount: stats.upvote_count,
      downvoteCount: stats.downvote_count,
      gamesJoined,
      questsClaimed: stats.quests_claimed,
      achievementCount,
      level: getLevelForXp(totalXp),
      gameDamageDealt: stats.game_damage_dealt,
      gameProfitEarned: stats.game_profit_earned,
      gameStabilityTicks: stats.game_stability_ticks,
    };
  }

  addPlayerXp(accountId: number, amount: number): number {
    this.ensurePlayerRow(accountId);
    const now = Date.now();
    this.db.prepare(`UPDATE player_progression SET total_xp = total_xp + ?, updated_at = ? WHERE account_id = ?`).run(amount, now, accountId);
    return (this.db.prepare(`SELECT total_xp FROM player_progression WHERE account_id = ?`).get(accountId) as { total_xp: number }).total_xp;
  }

  getPlayerXp(accountId: number): number {
    this.ensurePlayerRow(accountId);
    return (this.db.prepare(`SELECT total_xp FROM player_progression WHERE account_id = ?`).get(accountId) as { total_xp: number }).total_xp;
  }

  addPlayerDarkMatter(accountId: number, amount: number): number {
    this.ensurePlayerRow(accountId);
    const now = Date.now();
    this.db.prepare(
      `UPDATE player_progression SET dark_matter = dark_matter + ?, updated_at = ? WHERE account_id = ?`,
    ).run(Math.max(0, Math.floor(amount)), now, accountId);
    return this.getPlayerDarkMatter(accountId);
  }

  getPlayerDarkMatter(accountId: number): number {
    this.ensurePlayerRow(accountId);
    return (this.db.prepare(
      `SELECT dark_matter FROM player_progression WHERE account_id = ?`,
    ).get(accountId) as { dark_matter: number }).dark_matter;
  }

  spendPlayerDarkMatter(accountId: number, amount: number): number | null {
    const cost = Math.max(0, Math.floor(amount));
    this.ensurePlayerRow(accountId);
    if (cost === 0) return this.getPlayerDarkMatter(accountId);
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE player_progression
      SET dark_matter = dark_matter - ?, updated_at = ?
      WHERE account_id = ? AND dark_matter >= ?
    `).run(cost, now, accountId, cost);
    return result.changes > 0 ? this.getPlayerDarkMatter(accountId) : null;
  }

  awardGameXp(accountId: number, type: 'damage' | 'stability' | 'profit', rawValue: number): number {
    this.ensurePlayerRow(accountId);
    const rate = GAME_XP_RATES[type];
    const cap = GAME_XP_CAPS[type];
    const xp = Math.max(0, Math.min(Math.round(rawValue * rate), cap));
    if (xp === 0) return 0;
    const col = type === 'damage' ? 'game_damage_dealt' : type === 'profit' ? 'game_profit_earned' : 'game_stability_ticks';
    this.db.prepare(`UPDATE player_stats SET ${col} = ${col} + ? WHERE account_id = ?`).run(rawValue, accountId);
    this.addPlayerXp(accountId, xp);
    return xp;
  }

  getUnlockedAchievementIds(accountId: number): string[] {
    return (this.db.prepare(`SELECT achievement_id FROM player_achievements WHERE account_id = ?`).all(accountId) as Array<{ achievement_id: string }>).map((r) => r.achievement_id);
  }

  private unlockAchievement(
    accountId: number,
    achievementId: string,
    xpReward: number,
    darkMatterReward: number,
  ): boolean {
    const now = Date.now();
    const result = this.db.prepare(`INSERT OR IGNORE INTO player_achievements (account_id, achievement_id, unlocked_at) VALUES (?, ?, ?)`).run(accountId, achievementId, now);
    if (result.changes > 0) {
      if (xpReward > 0) this.addPlayerXp(accountId, xpReward);
      if (darkMatterReward > 0) this.addPlayerDarkMatter(accountId, darkMatterReward);
    }
    return result.changes > 0;
  }

  checkAndUnlockAchievements(accountId: number): string[] {
    this.ensurePlayerRow(accountId);
    const allUnlocked: string[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      const stats = this.getProgressionStats(accountId);
      const alreadyUnlocked = new Set(this.getUnlockedAchievementIds(accountId));
      for (const ach of ACHIEVEMENTS) {
        if (alreadyUnlocked.has(ach.id)) continue;
        if (ach.check(stats)) {
          if (this.unlockAchievement(accountId, ach.id, ach.xpReward, ach.darkMatterReward)) {
            allUnlocked.push(ach.id);
            changed = true;
          }
        }
      }
    }
    return allUnlocked;
  }

  upsertQuestProgress(accountId: number, questId: string, windowKey: string, amount: number, target: number): void {
    const now = Date.now();
    const initialProgress = Math.min(amount, target);
    const initialCompletedAt = amount >= target ? now : null;
    this.db.prepare(`
      INSERT INTO player_quests (account_id, quest_id, window_key, progress, completed_at, claimed_at)
      VALUES (@accountId, @questId, @windowKey, @initialProgress, @initialCompletedAt, NULL)
      ON CONFLICT(account_id, quest_id, window_key) DO UPDATE SET
        progress = CASE WHEN claimed_at IS NULL THEN MIN(progress + @amount, @target) ELSE progress END,
        completed_at = CASE
          WHEN claimed_at IS NULL AND completed_at IS NULL AND progress + @amount >= @target THEN @now
          ELSE completed_at
        END
    `).run({ accountId, questId, windowKey, initialProgress, initialCompletedAt, amount, target, now });
  }

  claimQuestReward(accountId: number, questId: string, windowKey: string): ClaimQuestResponse | null {
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE player_quests SET claimed_at = ?
      WHERE account_id = ? AND quest_id = ? AND window_key = ? AND completed_at IS NOT NULL AND claimed_at IS NULL
    `).run(now, accountId, questId, windowKey);
    if (result.changes === 0) return null;
    this.db.prepare(`UPDATE player_stats SET quests_claimed = quests_claimed + 1 WHERE account_id = ?`).run(accountId);
    const quest = [...WEEKLY_QUESTS, ...TRIDAY_QUESTS].find((definition) => definition.id === questId);
    const xpGained = quest?.xpReward ?? 0;
    const darkMatterGained = quest?.darkMatterReward ?? 0;
    this.addPlayerXp(accountId, xpGained);
    this.addPlayerDarkMatter(accountId, darkMatterGained);
    this.checkAndUnlockAchievements(accountId);
    const newTotalXp = this.getPlayerXp(accountId);
    return {
      xpGained,
      darkMatterGained,
      newTotalXp,
      newDarkMatter: this.getPlayerDarkMatter(accountId),
      newLevel: getLevelForXp(newTotalXp),
    };
  }

  onPlayerComment(accountId: number): void {
    this.ensurePlayerRow(accountId);
    this.db.prepare(`UPDATE player_stats SET comment_count = comment_count + 1 WHERE account_id = ?`).run(accountId);
    const now = Date.now();
    const weeklyKey = getWeeklyWindowKey(now);
    const tridayKey = getTridayWindowKey(now);
    const activeWeeklyIds = getActiveQuestIds(WEEKLY_QUESTS, getWeeklyWindowIndex(now));
    const activeTridayIds = getActiveQuestIds(TRIDAY_QUESTS, getTridayWindowIndex(now));
    for (const qid of activeWeeklyIds) {
      const q = WEEKLY_QUESTS.find((def) => def.id === qid && def.action === 'comment');
      if (q) this.upsertQuestProgress(accountId, qid, weeklyKey, 1, q.target);
    }
    for (const qid of activeTridayIds) {
      const q = TRIDAY_QUESTS.find((def) => def.id === qid && def.action === 'comment');
      if (q) this.upsertQuestProgress(accountId, qid, tridayKey, 1, q.target);
    }
    this.checkAndUnlockAchievements(accountId);
  }

  onPlayerVote(accountId: number, vote: number): void {
    this.ensurePlayerRow(accountId);
    this.db.prepare(`UPDATE player_stats SET vote_count = vote_count + 1 WHERE account_id = ?`).run(accountId);
    if (vote > 0) this.db.prepare(`UPDATE player_stats SET upvote_count = upvote_count + 1 WHERE account_id = ?`).run(accountId);
    if (vote < 0) this.db.prepare(`UPDATE player_stats SET downvote_count = downvote_count + 1 WHERE account_id = ?`).run(accountId);
    const now = Date.now();
    const weeklyKey = getWeeklyWindowKey(now);
    const tridayKey = getTridayWindowKey(now);
    const activeWeeklyIds = getActiveQuestIds(WEEKLY_QUESTS, getWeeklyWindowIndex(now));
    const activeTridayIds = getActiveQuestIds(TRIDAY_QUESTS, getTridayWindowIndex(now));
    const voteAction = vote > 0 ? 'upvote' : 'downvote';
    for (const qid of activeWeeklyIds) {
      const q = WEEKLY_QUESTS.find((def) => def.id === qid && (def.action === 'vote' || def.action === voteAction));
      if (q) this.upsertQuestProgress(accountId, qid, weeklyKey, 1, q.target);
    }
    for (const qid of activeTridayIds) {
      const q = TRIDAY_QUESTS.find((def) => def.id === qid && (def.action === 'vote' || def.action === voteAction));
      if (q) this.upsertQuestProgress(accountId, qid, tridayKey, 1, q.target);
    }
    this.checkAndUnlockAchievements(accountId);
  }

  buildPlayerProfile(account: AuthAccount): PlayerProfile {
    this.ensurePlayerRow(account.id);
    const now = Date.now();
    const totalXp = this.getPlayerXp(account.id);
    const { level, xpIntoLevel, xpForNextLevel, levelProgress } = getXpProgress(totalXp);
    const currentLevelDef = getLevelDef(level);
    const nextLevelDef = level < LEVELS.length ? getLevelDef(level + 1) : null;

    const unlockedMap = new Map(
      (this.db.prepare(`SELECT achievement_id, unlocked_at FROM player_achievements WHERE account_id = ?`).all(account.id) as Array<{ achievement_id: string; unlocked_at: number }>).map((r) => [r.achievement_id, r.unlocked_at]),
    );
    const achievements: AchievementInfo[] = ACHIEVEMENTS.map((ach) => ({
      id: ach.id,
      title: ach.title,
      description: ach.description,
      xpReward: ach.xpReward,
      darkMatterReward: ach.darkMatterReward,
      unlockedAt: unlockedMap.get(ach.id) ?? null,
    }));

    const weeklyIdx = getWeeklyWindowIndex(now);
    const tridayIdx = getTridayWindowIndex(now);
    const weeklyKey = getWeeklyWindowKey(now);
    const tridayKey = getTridayWindowKey(now);
    const activeWeeklyIds = getActiveQuestIds(WEEKLY_QUESTS, weeklyIdx);
    const activeTridayIds = getActiveQuestIds(TRIDAY_QUESTS, tridayIdx);
    const activeWeekly = WEEKLY_QUESTS.filter((q) => activeWeeklyIds.includes(q.id));
    const activeTriday = TRIDAY_QUESTS.filter((q) => activeTridayIds.includes(q.id));

    type QuestRow = { quest_id: string; progress: number; completed_at: number | null; claimed_at: number | null };
    const questProgressMap = new Map<string, QuestRow>();
    const queryProgress = (ids: string[], key: string) => {
      if (ids.length === 0) return;
      const placeholders = ids.map(() => '?').join(',');
      const rows = this.db.prepare(`SELECT quest_id, progress, completed_at, claimed_at FROM player_quests WHERE account_id = ? AND window_key = ? AND quest_id IN (${placeholders})`).all(account.id, key, ...ids) as QuestRow[];
      for (const row of rows) questProgressMap.set(`${key}:${row.quest_id}`, row);
    };
    queryProgress(activeWeeklyIds, weeklyKey);
    queryProgress(activeTridayIds, tridayKey);

    const toQuestInfo = (q: typeof WEEKLY_QUESTS[0], key: string): QuestInfo => {
      const p = questProgressMap.get(`${key}:${q.id}`);
      return {
        id: q.id, title: q.title, description: q.description,
        type: q.type, target: q.target, xpReward: q.xpReward,
        darkMatterReward: q.darkMatterReward, action: q.action,
        progress: p?.progress ?? 0,
        completedAt: p?.completed_at ?? null,
        claimedAt: p?.claimed_at ?? null,
        windowKey: key,
        resetsAt: getWindowResetTime(q.type, now),
      };
    };

    return {
      totalXp,
      darkMatter: this.getPlayerDarkMatter(account.id),
      level,
      levelName: currentLevelDef.name,
      levelColor: currentLevelDef.color,
      xpIntoLevel,
      xpForNextLevel,
      levelProgress,
      nextLevelName: nextLevelDef?.name ?? null,
      levels: LEVELS.map((l) => ({ level: l.level, name: l.name, xpRequired: l.xpRequired, color: l.color })),
      achievements,
      quests: [
        ...activeWeekly.map((q) => toQuestInfo(q, weeklyKey)),
        ...activeTriday.map((q) => toQuestInfo(q, tridayKey)),
      ],
    };
  }

  // ─── Direct Messages ──────────────────────────────────────────────────────────

  sendMessage(sender: AuthAccount, recipientUsernameInput: unknown, bodyInput: unknown): DirectMessage {
    const recipientUsername = sanitizePlainText(recipientUsernameInput, 'Recipient username', 80);
    const body = sanitizePlainText(bodyInput, 'Message body', 2000);

    if (recipientUsername.toLowerCase() === sender.username.toLowerCase()) {
      throw new AuthError('Cannot message yourself', 400);
    }
    const recipient = this.db.prepare(
      `SELECT id, username FROM accounts WHERE username = ? COLLATE NOCASE`,
    ).get(recipientUsername) as { id: number; username: string } | undefined;
    if (!recipient) throw new AuthError('User not found', 404);

    const now = Date.now();
    const result = this.db.prepare(
      `INSERT INTO messages (sender_id, recipient_id, body, sent_at) VALUES (?, ?, ?, ?)`,
    ).run(sender.id, recipient.id, body, now);
    return {
      id: Number(result.lastInsertRowid),
      senderId: sender.id,
      senderUsername: sender.username,
      recipientId: recipient.id,
      recipientUsername: recipient.username,
      body,
      sentAt: now,
      readAt: null,
    };
  }

  getConversations(accountId: number): DirectConversation[] {
    type Row = {
      partner_id: number; partner_username: string;
      id: number; sender_id: number; sender_username: string;
      recipient_id: number; recipient_username: string;
      body: string; sent_at: number; read_at: number | null;
      unread_count: number;
    };
    const rows = this.db.prepare(`
      SELECT
        partner.id          AS partner_id,
        partner.username    AS partner_username,
        m.id,
        m.sender_id,
        sa.username         AS sender_username,
        m.recipient_id,
        ra.username         AS recipient_username,
        m.body,
        m.sent_at,
        m.read_at,
        (SELECT COUNT(*) FROM messages u
         WHERE u.recipient_id = @me AND u.sender_id = partner.id AND u.read_at IS NULL
        ) AS unread_count
      FROM (
        SELECT
          CASE WHEN sender_id = @me THEN recipient_id ELSE sender_id END AS partner_id,
          MAX(id) AS last_id
        FROM messages
        WHERE sender_id = @me OR recipient_id = @me
        GROUP BY CASE WHEN sender_id = @me THEN recipient_id ELSE sender_id END
      ) conv
      JOIN accounts partner ON partner.id = conv.partner_id
      JOIN messages m ON m.id = conv.last_id
      JOIN accounts sa ON sa.id = m.sender_id
      JOIN accounts ra ON ra.id = m.recipient_id
      ORDER BY m.sent_at DESC
    `).all({ me: accountId }) as Row[];

    return rows.map((r) => ({
      partnerId: r.partner_id,
      partnerUsername: r.partner_username,
      unreadCount: r.unread_count,
      lastMessage: {
        id: r.id,
        senderId: r.sender_id,
        senderUsername: r.sender_username,
        recipientId: r.recipient_id,
        recipientUsername: r.recipient_username,
        body: r.body,
        sentAt: r.sent_at,
        readAt: r.read_at,
      },
    }));
  }

  getMessagesWith(accountId: number, partnerId: number, limit = 100): DirectMessage[] {
    type Row = {
      id: number; sender_id: number; sender_username: string;
      recipient_id: number; recipient_username: string;
      body: string; sent_at: number; read_at: number | null;
    };
    const rows = this.db.prepare(`
      SELECT m.id, m.sender_id, sa.username AS sender_username,
             m.recipient_id, ra.username AS recipient_username,
             m.body, m.sent_at, m.read_at
      FROM messages m
      JOIN accounts sa ON sa.id = m.sender_id
      JOIN accounts ra ON ra.id = m.recipient_id
      WHERE (m.sender_id = @me AND m.recipient_id = @partner)
         OR (m.sender_id = @partner AND m.recipient_id = @me)
      ORDER BY m.sent_at ASC
      LIMIT @limit
    `).all({ me: accountId, partner: partnerId, limit }) as Row[];
    return rows.map((r) => ({
      id: r.id,
      senderId: r.sender_id,
      senderUsername: r.sender_username,
      recipientId: r.recipient_id,
      recipientUsername: r.recipient_username,
      body: r.body,
      sentAt: r.sent_at,
      readAt: r.read_at,
    }));
  }

  markConversationRead(accountId: number, partnerId: number): void {
    this.db.prepare(
      `UPDATE messages SET read_at = ? WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL`,
    ).run(Date.now(), accountId, partnerId);
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

export function serializeSessionCookie(token: string, options?: { rememberMe?: boolean }): string {
  const attrs = buildCookieAttributes();
  if (options?.rememberMe === false) {
    return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs}`;
  }
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
