// Static progression definitions — levels, achievements, quests.
// To extend: append to LEVELS (keep xpRequired ascending), ACHIEVEMENTS, or the quest pools.
// The check function runs server-side only and is never serialised.

export interface LevelDef {
  level: number;
  name: string;
  xpRequired: number; // cumulative XP to reach this level
  color: string;      // accent color for the level badge
}

export interface ProgressionStats {
  commentCount: number;
  voteCount: number;
  upvoteCount: number;
  downvoteCount: number;
  gamesJoined: number;
  questsClaimed: number;
  achievementCount: number;
  level: number;
  // In-game activity stats (updated by game engine via /api/internal/game-xp)
  gameDamageDealt: number;
  gameProfitEarned: number;
  gameStabilityTicks: number;
}

// XP earned per unit of in-game activity (game engine calls /api/internal/game-xp).
// shipDamage: XP per damage point (cap 50 XP per combat event)
// stability:  XP per high-stability tick (≥75% avg planet stability, awarded each economy cycle)
// profit:     XP per credit of net profit (cap 25 XP per economy cycle)
export const GAME_XP_RATES = {
  damage:    0.05,
  stability: 6,
  profit:    0.002,
} as const;

export const GAME_XP_CAPS = {
  damage:    50,
  stability: 6,
  profit:    25,
} as const;

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  check: (stats: ProgressionStats) => boolean;
}

export type QuestAction = 'comment' | 'vote' | 'upvote' | 'downvote';

export interface QuestDef {
  id: string;
  title: string;
  description: string;
  type: 'weekly' | 'triday';
  target: number;
  xpReward: number;
  action: QuestAction;
}

// ─── 20 Levels ───────────────────────────────────────────────────────────────

export const LEVELS: LevelDef[] = [
  { level:  1, name: 'Recruit',            xpRequired:       0, color: '#607d8b' },
  { level:  2, name: 'Ensign',             xpRequired:     300, color: '#4da6c9' },
  { level:  3, name: 'Cadet',              xpRequired:     800, color: '#29a4d8' },
  { level:  4, name: 'Scout',              xpRequired:    1600, color: '#0d9adb' },
  { level:  5, name: 'Surveyor',           xpRequired:    2800, color: '#0087dd' },
  { level:  6, name: 'Navigator',          xpRequired:    4400, color: '#00a89d' },
  { level:  7, name: 'Pilot',              xpRequired:    6400, color: '#00b97b' },
  { level:  8, name: 'Captain',            xpRequired:    9000, color: '#00c658' },
  { level:  9, name: 'Vanguard',           xpRequired:   12500, color: '#4dcc3a' },
  { level: 10, name: 'Commander',          xpRequired:   17000, color: '#8dc030' },
  { level: 11, name: 'Fleet Captain',      xpRequired:   22500, color: '#c0a820' },
  { level: 12, name: 'Commodore',          xpRequired:   29500, color: '#d08020' },
  { level: 13, name: 'Rear Admiral',       xpRequired:   38000, color: '#d06018' },
  { level: 14, name: 'Vice Admiral',       xpRequired:   48000, color: '#cc3818' },
  { level: 15, name: 'Admiral',            xpRequired:   60000, color: '#c02020' },
  { level: 16, name: 'Grand Admiral',      xpRequired:   75000, color: '#b81820' },
  { level: 17, name: 'Fleet Admiral',      xpRequired:   93000, color: '#a01890' },
  { level: 18, name: 'Star Marshal',       xpRequired:  115000, color: '#8818d0' },
  { level: 19, name: 'Warlord',            xpRequired:  140000, color: '#6018d8' },
  { level: 20, name: 'Galactic Sovereign', xpRequired:  200000, color: '#e8a800' },
];

// ─── 20 Achievements ─────────────────────────────────────────────────────────

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first-contact',
    title: 'First Contact',
    description: 'Create your StellarFronts account.',
    xpReward: 0,
    check: () => true,
  },
  {
    id: 'voice-of-command',
    title: 'Voice of Command',
    description: 'Post your first news comment.',
    xpReward: 50,
    check: (s) => s.commentCount >= 1,
  },
  {
    id: 'loud-speaker',
    title: 'Loud Speaker',
    description: 'Post 10 news comments.',
    xpReward: 100,
    check: (s) => s.commentCount >= 10,
  },
  {
    id: 'fleet-correspondent',
    title: 'Fleet Correspondent',
    description: 'Post 25 news comments.',
    xpReward: 200,
    check: (s) => s.commentCount >= 25,
  },
  {
    id: 'galactic-voice',
    title: 'Galactic Voice',
    description: 'Post 50 news comments.',
    xpReward: 400,
    check: (s) => s.commentCount >= 50,
  },
  {
    id: 'analyst',
    title: 'Analyst',
    description: 'Vote on a news comment.',
    xpReward: 50,
    check: (s) => s.voteCount >= 1,
  },
  {
    id: 'intelligence-officer',
    title: 'Intelligence Officer',
    description: 'Vote on 20 news comments.',
    xpReward: 100,
    check: (s) => s.voteCount >= 20,
  },
  {
    id: 'tactical-feedback',
    title: 'Tactical Feedback',
    description: 'Cast 50 votes total.',
    xpReward: 200,
    check: (s) => s.voteCount >= 50,
  },
  {
    id: 'frontline',
    title: 'Frontline',
    description: 'Join your first game.',
    xpReward: 100,
    check: (s) => s.gamesJoined >= 1,
  },
  {
    id: 'multi-front',
    title: 'Multi-Front',
    description: 'Join 3 different games.',
    xpReward: 200,
    check: (s) => s.gamesJoined >= 3,
  },
  {
    id: 'veteran-strategist',
    title: 'Veteran Strategist',
    description: 'Join 5 different games.',
    xpReward: 400,
    check: (s) => s.gamesJoined >= 5,
  },
  {
    id: 'quest-accepted',
    title: 'Quest Accepted',
    description: 'Complete your first quest.',
    xpReward: 50,
    check: (s) => s.questsClaimed >= 1,
  },
  {
    id: 'on-schedule',
    title: 'On Schedule',
    description: 'Complete 10 quests.',
    xpReward: 150,
    check: (s) => s.questsClaimed >= 10,
  },
  {
    id: 'relentless',
    title: 'Relentless',
    description: 'Complete 25 quests.',
    xpReward: 300,
    check: (s) => s.questsClaimed >= 25,
  },
  {
    id: 'quest-veteran',
    title: 'Quest Veteran',
    description: 'Complete 50 quests.',
    xpReward: 500,
    check: (s) => s.questsClaimed >= 50,
  },
  {
    id: 'rising-star',
    title: 'Rising Star',
    description: 'Reach level 5.',
    xpReward: 100,
    check: (s) => s.level >= 5,
  },
  {
    id: 'high-command',
    title: 'High Command',
    description: 'Reach level 10.',
    xpReward: 250,
    check: (s) => s.level >= 10,
  },
  {
    id: 'grand-marshal',
    title: 'Grand Marshal',
    description: 'Reach level 15.',
    xpReward: 500,
    check: (s) => s.level >= 15,
  },
  {
    id: 'the-collector',
    title: 'The Collector',
    description: 'Unlock 10 achievements.',
    xpReward: 200,
    check: (s) => s.achievementCount >= 10,
  },
  {
    id: 'first-blood',
    title: 'First Blood',
    description: 'Deal 100 damage to enemy ships in battle.',
    xpReward: 75,
    check: (s) => s.gameDamageDealt >= 100,
  },
  {
    id: 'warmonger',
    title: 'Warmonger',
    description: 'Deal 5,000 total damage to enemy ships.',
    xpReward: 250,
    check: (s) => s.gameDamageDealt >= 5000,
  },
  {
    id: 'stable-dominion',
    title: 'Stable Dominion',
    description: 'Earn 25 planet stability bonuses.',
    xpReward: 150,
    check: (s) => s.gameStabilityTicks >= 25,
  },
  {
    id: 'galactic-merchant',
    title: 'Galactic Merchant',
    description: 'Accumulate 10,000 credits in economic profit.',
    xpReward: 200,
    check: (s) => s.gameProfitEarned >= 10000,
  },
  {
    id: 'completionist',
    title: 'Completionist',
    description: 'Unlock all achievements.',
    xpReward: 1000,
    // Always requires all others — auto-adjusts as the list grows.
    check: (s) => s.achievementCount >= ACHIEVEMENTS.length - 1,
  },
];

// ─── 20 Quests (10 weekly pool + 10 triday pool) ─────────────────────────────
// Active set is 5 from each pool, rotating each window.

export const WEEKLY_QUESTS: QuestDef[] = [
  { id: 'wq-tactical-debrief',    title: 'Tactical Debrief',    description: 'Post 3 news comments.',          type: 'weekly', action: 'comment',   target:  3, xpReward:  75 },
  { id: 'wq-fleet-intelligence',  title: 'Fleet Intelligence',  description: 'Cast 10 votes on comments.',     type: 'weekly', action: 'vote',      target: 10, xpReward:  75 },
  { id: 'wq-commanders-voice',    title: "Commander's Voice",   description: 'Post 5 news comments.',          type: 'weekly', action: 'comment',   target:  5, xpReward: 100 },
  { id: 'wq-analysts-report',     title: "Analyst's Report",    description: 'Cast 20 votes.',                 type: 'weekly', action: 'vote',      target: 20, xpReward: 125 },
  { id: 'wq-signal-corps',        title: 'Signal Corps',        description: 'Post 8 news comments.',          type: 'weekly', action: 'comment',   target:  8, xpReward: 150 },
  { id: 'wq-vote-of-confidence',  title: 'Vote of Confidence',  description: 'Cast 15 upvotes.',               type: 'weekly', action: 'upvote',    target: 15, xpReward: 100 },
  { id: 'wq-critical-assessment', title: 'Critical Assessment', description: 'Cast 15 downvotes.',             type: 'weekly', action: 'downvote',  target: 15, xpReward: 100 },
  { id: 'wq-operations-log',      title: 'Operations Log',      description: 'Post 12 comments.',              type: 'weekly', action: 'comment',   target: 12, xpReward: 175 },
  { id: 'wq-intelligence-sweep',  title: 'Intelligence Sweep',  description: 'Cast 30 votes.',                 type: 'weekly', action: 'vote',      target: 30, xpReward: 150 },
  { id: 'wq-press-corps',         title: 'Press Corps',         description: 'Post 15 comments this week.',   type: 'weekly', action: 'comment',   target: 15, xpReward: 200 },
];

export const TRIDAY_QUESTS: QuestDef[] = [
  { id: 'tq-field-report',      title: 'Field Report',      description: 'Post 1 news comment.',        type: 'triday', action: 'comment',  target:  1, xpReward: 25 },
  { id: 'tq-quick-analysis',    title: 'Quick Analysis',    description: 'Cast 3 votes.',               type: 'triday', action: 'vote',     target:  3, xpReward: 25 },
  { id: 'tq-positive-intel',    title: 'Positive Intel',    description: 'Cast 2 upvotes.',             type: 'triday', action: 'upvote',   target:  2, xpReward: 20 },
  { id: 'tq-threat-assessment', title: 'Threat Assessment', description: 'Cast 2 downvotes.',           type: 'triday', action: 'downvote', target:  2, xpReward: 20 },
  { id: 'tq-daily-briefing',    title: 'Daily Briefing',    description: 'Post 2 comments.',            type: 'triday', action: 'comment',  target:  2, xpReward: 35 },
  { id: 'tq-rapid-response',    title: 'Rapid Response',    description: 'Cast 5 votes.',               type: 'triday', action: 'vote',     target:  5, xpReward: 35 },
  { id: 'tq-intel-gathering',   title: 'Intel Gathering',   description: 'Post 3 comments.',            type: 'triday', action: 'comment',  target:  3, xpReward: 45 },
  { id: 'tq-tactical-vote',     title: 'Tactical Vote',     description: 'Cast 8 votes.',               type: 'triday', action: 'vote',     target:  8, xpReward: 45 },
  { id: 'tq-support-ops',       title: 'Support Operations',description: 'Cast 4 upvotes.',             type: 'triday', action: 'upvote',   target:  4, xpReward: 35 },
  { id: 'tq-counter-intel',     title: 'Counter-Intel',     description: 'Cast 4 downvotes.',           type: 'triday', action: 'downvote', target:  4, xpReward: 35 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getLevelForXp(totalXp: number): number {
  let level = 1;
  for (const def of LEVELS) {
    if (totalXp >= def.xpRequired) level = def.level;
    else break;
  }
  return level;
}

export function getLevelDef(level: number): LevelDef {
  return LEVELS[Math.max(0, Math.min(level - 1, LEVELS.length - 1))];
}

export function getXpProgress(totalXp: number): {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  levelProgress: number;
} {
  const level = getLevelForXp(totalXp);
  const def = getLevelDef(level);
  const nextDef = level < LEVELS.length ? getLevelDef(level + 1) : null;
  const xpIntoLevel = totalXp - def.xpRequired;
  const xpForNextLevel = nextDef ? nextDef.xpRequired - def.xpRequired : 0;
  const levelProgress = xpForNextLevel > 0 ? Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100)) : 100;
  return { level, xpIntoLevel, xpForNextLevel, levelProgress };
}

/** Returns the `count` quest IDs active in the given window for a pool. */
export function getActiveQuestIds(pool: QuestDef[], windowIndex: number, count = 5): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(pool[(windowIndex * count + i) % pool.length].id);
  }
  return ids;
}

const MS_WEEK  = 7 * 24 * 3600 * 1000;
const MS_TRIDAY = 3 * 24 * 3600 * 1000;

export function getWeeklyWindowIndex(now = Date.now()): number {
  return Math.floor(now / MS_WEEK);
}

export function getTridayWindowIndex(now = Date.now()): number {
  return Math.floor(now / MS_TRIDAY);
}

export function getWeeklyWindowKey(now = Date.now()): string {
  return `w${getWeeklyWindowIndex(now)}`;
}

export function getTridayWindowKey(now = Date.now()): string {
  return `t${getTridayWindowIndex(now)}`;
}

export function getWindowResetTime(type: 'weekly' | 'triday', now = Date.now()): number {
  const ms = type === 'weekly' ? MS_WEEK : MS_TRIDAY;
  return (Math.floor(now / ms) + 1) * ms;
}
