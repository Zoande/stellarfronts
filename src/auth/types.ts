import type { FlagDesign } from '../flags/flagTypes';
import type { SpeciesSetup } from '../data/Species';

export type AccountType = 'observer' | 'user' | 'admin';

export interface AuthAccount {
  id: number;
  username: string;
  accountType: AccountType;
  // Legacy account records exposed this value. Gameplay membership is per-game now.
  factionId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface LoginCredentials extends Credentials {
  rememberMe?: boolean;
}

export interface AuthSessionResponse {
  account: AuthAccount;
}

export interface AuthMeResponse {
  account: AuthAccount | null;
}

export interface DevActivitySeriesPoint {
  label: string;
  timestamp: number;
  logins: number;
  signups: number;
  gameEnters: number;
  uniqueGameAccounts: number;
}

export interface DevLatestAccount {
  id: number;
  username: string;
  accountType: AccountType;
  factionId: number | null;
  createdAt: number;
  lastLoginAt: number | null;
  loginCount: number;
  gameEnterCount: number;
}

export interface DevAccountsSummary {
  total: number;
  users: number;
  seededFactions: number;
  observers: number;
  admins: number;
  latest: DevLatestAccount[];
}

export interface DevActivitySummary {
  loginsTotal: number;
  logins24h: number;
  signupsTotal: number;
  signups24h: number;
  gameEntersTotal: number;
  gameEnters24h: number;
  activeAuthSessions: number;
  series: DevActivitySeriesPoint[];
}

export interface DevGameRuntimeStats {
  online: boolean;
  activeConnections: number;
  activeAccounts: string[];
  serverStartedAt: number | null;
  lastHeartbeatAt: number | null;
  gameYear: number | null;
  paused: boolean;
  speedMultiplier: number;
  starCount: number;
  factionCount: number;
  fleetCount: number;
  shipCount: number;
  starbaseCount: number;
  planetCount: number;
  habitedPlanetCount: number;
  combatContactCount: number;
  gameCount: number;
  games: DevGameRuntimeRow[];
  processes?: DevVersionProcessHealth[];
  failures?: DevRuntimeFailure[];
}

export interface DevGameRuntimeRow {
  id: string;
  name: string;
  seed: number;
  countryCapacity: number;
  controlledCountries: number;
  createdAt: number;
  online: boolean;
  activeConnections: number;
  activeAccounts: string[];
  gameYear: number | null;
  paused: boolean;
  speedMultiplier: number;
  starCount: number;
  factionCount: number;
  fleetCount: number;
  shipCount: number;
  starbaseCount: number;
  habitedPlanetCount: number;
  lastHeartbeatAt: number | null;
  versionId?: string;
  health?: 'healthy' | 'loading' | 'failed' | 'offline';
  error?: string | null;
  lastSaveAt?: number | null;
  lastTickDurationMs?: number;
  maxTickDurationMs?: number;
}

export interface DevRuntimeFailure {
  gameId: string;
  gameName: string;
  versionId: string;
  message: string;
  failedAt: number;
}

export interface DevVersionProcessHealth {
  versionId: string;
  pid: number;
  startedAt: number;
  lastHeartbeatAt: number;
  loadedGames: number;
  loadingGames: number;
  failedGames: number;
  lastLoopDurationMs: number;
  maxLoopDurationMs: number;
}

export interface DevStatsResponse {
  generatedAt: number;
  accounts: DevAccountsSummary;
  activity: DevActivitySummary;
  game: DevGameRuntimeStats;
}

export interface GameMembership {
  gameId: string;
  accountId: number;
  factionId: number;
  countryName: string;
  flagDesign: FlagDesign | null;
  speciesSetup: SpeciesSetup | null;
  joinedAt: number;
}

export interface GameSummary {
  id: string;
  name: string;
  seed: number;
  countryCapacity: number;
  controlledCountries: number;
  createdAt: number;
  isFull: boolean;
  isJoined: boolean;
  joinable: boolean;
  lastEnteredAt: number | null;
  membership: GameMembership | null;
}

export interface GamesResponse {
  games: GameSummary[];
}

export interface JoinGameResponse {
  game: GameSummary;
  membership: GameMembership | null;
}

export type NewsPostStatus = 'draft' | 'published';
export type NewsCommentVote = -1 | 0 | 1;

export interface NewsAuthor {
  id: number;
  username: string;
}

export interface NewsHeadingBlock {
  id: string;
  type: 'heading';
  text: string;
}

export interface NewsParagraphBlock {
  id: string;
  type: 'paragraph';
  text: string;
}

export interface NewsImageBlock {
  id: string;
  type: 'image';
  imageUrl: string;
  altText: string;
  caption: string;
}

export type NewsContentBlock = NewsHeadingBlock | NewsParagraphBlock | NewsImageBlock;

export interface NewsComment {
  id: number;
  postId: string;
  author: NewsAuthor;
  body: string;
  score: number;
  userVote: NewsCommentVote;
  createdAt: number;
  updatedAt: number;
}

export interface NewsPostListItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  coverImageUrl: string | null;
  status: NewsPostStatus;
  author: NewsAuthor;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  commentCount: number;
}

export interface NewsPost extends NewsPostListItem {
  blocks: NewsContentBlock[];
  comments: NewsComment[];
}

export interface NewsPostsResponse {
  posts: NewsPostListItem[];
}

export interface NewsPostResponse {
  post: NewsPost;
}

export interface NewsPostMutationPayload {
  title: string;
  summary: string;
  coverImageUrl?: string | null;
  blocks: NewsContentBlock[];
  status?: NewsPostStatus;
}

export interface NewsCommentResponse {
  comment: NewsComment;
}

export interface NewsMediaResponse {
  url: string;
}

export interface NewsMediaFile {
  name: string;
  url: string;
}

export interface NewsMediaListResponse {
  files: NewsMediaFile[];
}

// ─── Player Progression ───────────────────────────────────────────────────────

export interface LevelInfo {
  level: number;
  name: string;
  xpRequired: number;
  color: string;
}

export interface AchievementInfo {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  darkMatterReward: number;
  unlockedAt: number | null;
}

export interface QuestInfo {
  id: string;
  title: string;
  description: string;
  type: 'weekly' | 'triday';
  target: number;
  xpReward: number;
  darkMatterReward: number;
  action: string;
  progress: number;
  completedAt: number | null;
  claimedAt: number | null;
  windowKey: string;
  resetsAt: number;
}

export interface PlayerProfile {
  totalXp: number;
  darkMatter: number;
  level: number;
  levelName: string;
  levelColor: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
  levelProgress: number;
  nextLevelName: string | null;
  levels: LevelInfo[];
  achievements: AchievementInfo[];
  quests: QuestInfo[];
}

export interface PlayerProfileResponse {
  profile: PlayerProfile;
}

export interface ClaimQuestResponse {
  xpGained: number;
  darkMatterGained: number;
  newTotalXp: number;
  newDarkMatter: number;
  newLevel: number;
}

// ─── Direct Messages ──────────────────────────────────────────────────────────

export interface DirectMessage {
  id: number;
  senderId: number;
  senderUsername: string;
  recipientId: number;
  recipientUsername: string;
  body: string;
  sentAt: number;
  readAt: number | null;
}

export interface DirectConversation {
  partnerId: number;
  partnerUsername: string;
  unreadCount: number;
  lastMessage: DirectMessage;
}

export interface ConversationsResponse {
  conversations: DirectConversation[];
}

export interface MessagesWithResponse {
  messages: DirectMessage[];
}

export interface SendMessageResponse {
  message: DirectMessage;
}
