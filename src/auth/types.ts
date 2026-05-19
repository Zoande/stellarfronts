import type { GalaxyPerspective } from '@/data/Factions';

export type AccountType = 'seeded-faction' | 'observer' | 'user' | 'admin';

export interface AuthAccount {
  id: number;
  username: string;
  accountType: AccountType;
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
}

export interface DevStatsResponse {
  generatedAt: number;
  accounts: DevAccountsSummary;
  activity: DevActivitySummary;
  game: DevGameRuntimeStats;
}

export function getPerspectiveForAccount(account: AuthAccount): GalaxyPerspective {
  if (account.accountType === 'seeded-faction' && account.factionId !== null) {
    return { mode: 'faction', factionId: account.factionId };
  }

  return { mode: 'observer' };
}
