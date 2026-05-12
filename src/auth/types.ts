import type { GalaxyPerspective } from '@/data/Factions';

export type AccountType = 'seeded-faction' | 'observer' | 'user';

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