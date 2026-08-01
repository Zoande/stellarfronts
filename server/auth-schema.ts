import type { AuthDatabaseConnection } from "./auth-database";

/** Owns control-plane schema creation and additive SQLite migrations. */
export function initializeAuthSchema(db: AuthDatabaseConnection): void {
  db.exec(`
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

  const membershipColumns = db.prepare(`PRAGMA table_info(game_memberships)`).all() as Array<{ name: string }>;
  if (!membershipColumns.some((column) => column.name === 'flag_design')) {
    db.exec(`ALTER TABLE game_memberships ADD COLUMN flag_design TEXT`);
  }
  if (!membershipColumns.some((column) => column.name === 'species_setup')) {
    db.exec(`ALTER TABLE game_memberships ADD COLUMN species_setup TEXT`);
  }

  const gameColumns = db.prepare(`PRAGMA table_info(games)`).all() as Array<{ name: string }>;
  if (!gameColumns.some((column) => column.name === 'version_id')) {
    db.exec(`ALTER TABLE games ADD COLUMN version_id TEXT NOT NULL DEFAULT 'dev'`);
  }
  if (!gameColumns.some((column) => column.name === 'status')) {
    db.exec(`ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
  if (!gameColumns.some((column) => column.name === 'schema_version')) {
    db.exec(`ALTER TABLE games ADD COLUMN schema_version INTEGER`);
  }
  if (!gameColumns.some((column) => column.name === 'protocol_version')) {
    db.exec(`ALTER TABLE games ADD COLUMN protocol_version INTEGER`);
  }

  const versionColumns = db.prepare(`PRAGMA table_info(game_versions)`).all() as Array<{ name: string }>;
  if (!versionColumns.some((column) => column.name === 'commit_sha')) {
    db.exec(`ALTER TABLE game_versions ADD COLUMN commit_sha TEXT`);
  }
  if (!versionColumns.some((column) => column.name === 'ref_type')) {
    db.exec(`ALTER TABLE game_versions ADD COLUMN ref_type TEXT`);
  }

  db.prepare(`
    UPDATE accounts
    SET account_type = 'user', faction_id = NULL, updated_at = ?
    WHERE account_type = 'seeded-faction'
  `).run(Date.now());
}
