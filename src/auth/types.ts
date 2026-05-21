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
