import type { AuthDatabaseConnection } from "./auth-database";

abstract class AuthRepository {
  constructor(protected readonly db: AuthDatabaseConnection) {}
}

export class AccountsSessionsRepository extends AuthRepository {
  findAccountByUsername(username: string): unknown {
    return this.db.prepare("SELECT * FROM accounts WHERE username = ?").get(username);
  }

  findAccountById(accountId: number): unknown {
    return this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
  }

  findAccountBySessionHash(tokenHash: string, now: number): unknown {
    return this.db.prepare(`
      SELECT accounts.*
      FROM sessions
      INNER JOIN accounts ON accounts.id = sessions.account_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(tokenHash, now);
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }
}

export class GamesRepository extends AuthRepository {
  findGame(gameId: string): unknown {
    return this.db.prepare("SELECT * FROM games WHERE id = ?").get(gameId);
  }

  listGames(): unknown[] {
    return this.db.prepare("SELECT * FROM games ORDER BY created_at DESC, id ASC").all();
  }

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)();
  }
}

export class NewsRepository extends AuthRepository {
  listPosts(includeDrafts: boolean): unknown[] {
    return this.db.prepare(`
      SELECT
        p.*,
        a.username AS author_username,
        COUNT(c.id) AS comment_count
      FROM news_posts p
      JOIN accounts a ON a.id = p.author_account_id
      LEFT JOIN news_comments c ON c.post_id = p.id
      ${includeDrafts ? "" : "WHERE p.status = 'published'"}
      GROUP BY p.id
      ORDER BY COALESCE(p.published_at, p.updated_at) DESC, p.created_at DESC
    `).all();
  }
}

export class ProgressionRepository extends AuthRepository {
  ensurePlayer(accountId: number, now: number): void {
    this.db.prepare(
      "INSERT OR IGNORE INTO player_progression (account_id, total_xp, dark_matter, updated_at) VALUES (?, 0, 0, ?)",
    ).run(accountId, now);
    this.db.prepare(
      "INSERT OR IGNORE INTO player_stats (account_id, comment_count, vote_count, upvote_count, downvote_count, quests_claimed, game_damage_dealt, game_profit_earned, game_stability_ticks) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0)",
    ).run(accountId);
  }

  getXp(accountId: number): number {
    const row = this.db.prepare("SELECT total_xp FROM player_progression WHERE account_id = ?")
      .get(accountId) as { total_xp: number } | undefined;
    return row?.total_xp ?? 0;
  }

  getDarkMatter(accountId: number): number {
    const row = this.db.prepare("SELECT dark_matter FROM player_progression WHERE account_id = ?")
      .get(accountId) as { dark_matter: number } | undefined;
    return row?.dark_matter ?? 0;
  }
}

export class DirectMessagesRepository extends AuthRepository {
  markConversationRead(accountId: number, partnerId: number, now: number): void {
    this.db.prepare(
      "UPDATE messages SET read_at = ? WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL",
    ).run(now, accountId, partnerId);
  }
}

export interface AuthRepositories {
  accounts: AccountsSessionsRepository;
  games: GamesRepository;
  news: NewsRepository;
  progression: ProgressionRepository;
  messages: DirectMessagesRepository;
}

export function createAuthRepositories(db: AuthDatabaseConnection): AuthRepositories {
  return {
    accounts: new AccountsSessionsRepository(db),
    games: new GamesRepository(db),
    news: new NewsRepository(db),
    progression: new ProgressionRepository(db),
    messages: new DirectMessagesRepository(db),
  };
}
