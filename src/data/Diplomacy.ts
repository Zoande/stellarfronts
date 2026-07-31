export type BorderPolicy = "open" | "closed";
export type TreatyArticleId = "tradePrivilege" | "migrationPact";
export type DiplomacyProposalKind = "treaty" | "peace";
export type DiplomacyProposalStatus = "pending" | "accepted" | "declined" | "cancelled";
export type PeaceMode = "whitePeace" | "statusQuo";

export interface TreatyArticleEffect {
  type: "marketMerge" | "migrationAccess";
  multiplier?: number;
}

export interface TreatyArticleDefinition {
  id: TreatyArticleId;
  name: string;
  summary: string;
  description: string;
  suspendOnWar: boolean;
  effects: TreatyArticleEffect[];
}

export interface DiplomacyBorderPolicy {
  ownerFactionId: number;
  targetFactionId: number;
  policy: BorderPolicy;
}

export interface DiplomacyWar {
  id: string;
  attackerFactionId: number;
  defenderFactionId: number;
  startedAtYear: number;
  endedAtYear?: number | null;
  preWarOwnership: Array<[number, number]>;
}

export interface DiplomacyTreaty {
  id: string;
  factionIds: [number, number];
  articleIds: TreatyArticleId[];
  proposedByFactionId: number;
  acceptedByFactionId: number;
  startedAtYear: number;
  minimumEndYear: number;
  cancelledAtYear?: number | null;
  earlyCancelled?: boolean;
  cancellationReason?: string | null;
  replacedByTreatyId?: string | null;
}

export interface DiplomacySystemTransferTerm {
  starbaseId: string;
  fromFactionId: number;
  toFactionId: number;
}

export interface DiplomacyPeaceTerms {
  mode: PeaceMode;
  transfers: DiplomacySystemTransferTerm[];
  enforcedArticleIds: TreatyArticleId[];
  enforcedDurationYears: number;
}

export interface DiplomacyProposal {
  id: string;
  kind: DiplomacyProposalKind;
  fromFactionId: number;
  toFactionId: number;
  articleIds: TreatyArticleId[];
  durationYears: number;
  peaceTerms?: DiplomacyPeaceTerms | null;
  status: DiplomacyProposalStatus;
  createdAtYear: number;
  resolvedAtYear?: number | null;
  responseByFactionId?: number | null;
  replacesTreatyId?: string | null;
}

export interface DiplomacyChatMessage {
  id: string;
  fromFactionId: number;
  toFactionId: number;
  body: string;
  createdAtYear: number;
}

export interface DiplomacyState {
  borders: DiplomacyBorderPolicy[];
  wars: DiplomacyWar[];
  treaties: DiplomacyTreaty[];
  proposals: DiplomacyProposal[];
  chatMessages: DiplomacyChatMessage[];
}

export const TREATY_MIN_YEARS = 1;
export const TREATY_MAX_YEARS = 100;
export const TREATY_DEFAULT_YEARS = 10;
export const DIPLOMACY_CHAT_LIMIT_PER_PAIR = 200;
export const TRADE_PRIVILEGE_ARTICLE_ID: TreatyArticleId = "tradePrivilege";
export const MIGRATION_PACT_ARTICLE_ID: TreatyArticleId = "migrationPact";

export const TREATY_ARTICLE_DEFINITIONS: TreatyArticleDefinition[] = [
  {
    id: TRADE_PRIVILEGE_ARTICLE_ID,
    name: "Trade Privilege",
    summary: "Merge both countries into one connected internal market.",
    description: "Connected treaty partners fully pool production, upkeep, and recent trade pressure when calculating prices. Stockpiles and orders remain separate.",
    suspendOnWar: true,
    effects: [{ type: "marketMerge" }],
  },
  {
    id: MIGRATION_PACT_ARTICLE_ID,
    name: "Migration Pact",
    summary: "Authorizes voluntary population movement between both empires.",
    description: "Species with Free Migration rights in both countries may relocate through this pact. War suspends all movement until the pact becomes active again.",
    suspendOnWar: true,
    effects: [{ type: "migrationAccess" }],
  },
];

const TREATY_ARTICLE_BY_ID = new Map<TreatyArticleId, TreatyArticleDefinition>(
  TREATY_ARTICLE_DEFINITIONS.map((article) => [article.id, article]),
);

const PROPOSAL_STATUSES: DiplomacyProposalStatus[] = ["pending", "accepted", "declined", "cancelled"];

export function createInitialDiplomacyState(factionIds: number[]): DiplomacyState {
  return {
    borders: createDefaultBorderPolicies(factionIds),
    wars: [],
    treaties: [],
    proposals: [],
    chatMessages: [],
  };
}

export function normalizeDiplomacyState(
  diplomacy: Partial<DiplomacyState> | null | undefined,
  factionIds: number[],
): { state: DiplomacyState; changed: boolean } {
  const normalizedFactionIds = normalizeFactionIds(factionIds);
  const original = JSON.stringify(diplomacy ?? null);
  const state: DiplomacyState = {
    borders: normalizeBorderPolicies(diplomacy?.borders, normalizedFactionIds),
    wars: normalizeWars(diplomacy?.wars, normalizedFactionIds),
    treaties: normalizeTreaties(diplomacy?.treaties, normalizedFactionIds),
    proposals: normalizeProposals(diplomacy?.proposals, normalizedFactionIds),
    chatMessages: normalizeChatMessages(diplomacy?.chatMessages, normalizedFactionIds),
  };
  return {
    state,
    changed: original !== JSON.stringify(state),
  };
}

export function getDiplomacyPairKey(a: number, b: number): string {
  return normalizePair(a, b).join(":");
}

export function getBorderPolicy(state: DiplomacyState, ownerFactionId: number, targetFactionId: number): BorderPolicy {
  if (ownerFactionId === targetFactionId) return "open";
  return state.borders.find((border) => (
    border.ownerFactionId === ownerFactionId
    && border.targetFactionId === targetFactionId
  ))?.policy ?? "closed";
}

export function setBorderPolicy(
  state: DiplomacyState,
  ownerFactionId: number,
  targetFactionId: number,
  policy: BorderPolicy,
): void {
  if (ownerFactionId === targetFactionId) return;
  const normalizedPolicy: BorderPolicy = policy === "open" ? "open" : "closed";
  const border = state.borders.find((candidate) => (
    candidate.ownerFactionId === ownerFactionId
    && candidate.targetFactionId === targetFactionId
  ));
  if (border) {
    border.policy = normalizedPolicy;
    return;
  }
  state.borders.push({ ownerFactionId, targetFactionId, policy: normalizedPolicy });
}

export function areFactionsAtWar(state: DiplomacyState, factionA: number, factionB: number): boolean {
  return getActiveWar(state, factionA, factionB) !== null;
}

export function getActiveWar(state: DiplomacyState, factionA: number, factionB: number): DiplomacyWar | null {
  if (factionA === factionB) return null;
  return state.wars.find((war) => (
    !Number.isFinite(war.endedAtYear ?? Number.NaN)
    && pairMatches(war.attackerFactionId, war.defenderFactionId, factionA, factionB)
  )) ?? null;
}

export function getTreatyArticleDefinition(articleId: TreatyArticleId): TreatyArticleDefinition | null {
  return TREATY_ARTICLE_BY_ID.get(articleId) ?? null;
}

export function clampTreatyDurationYears(value: unknown, fallback = TREATY_DEFAULT_YEARS): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(TREATY_MIN_YEARS, Math.min(TREATY_MAX_YEARS, Math.round(numeric)));
}

export function getActiveTreatiesBetween(
  state: DiplomacyState,
  factionA: number,
  factionB: number,
): DiplomacyTreaty[] {
  if (factionA === factionB) return [];
  return state.treaties.filter((treaty) => (
    !Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)
    && pairMatches(treaty.factionIds[0], treaty.factionIds[1], factionA, factionB)
  ));
}

export function isTreatyArticleSuspended(
  state: DiplomacyState,
  articleId: TreatyArticleId,
  factionA: number,
  factionB: number,
): boolean {
  const article = getTreatyArticleDefinition(articleId);
  return article?.suspendOnWar === true && areFactionsAtWar(state, factionA, factionB);
}

export function getActiveTreatyPartnersForArticle(
  state: DiplomacyState,
  factionId: number,
  articleId: TreatyArticleId,
): number[] {
  const partners = new Set<number>();
  for (const treaty of state.treaties) {
    if (Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)) continue;
    if (!treaty.articleIds.includes(articleId)) continue;
    if (treaty.factionIds[0] !== factionId && treaty.factionIds[1] !== factionId) continue;
    const partnerId = treaty.factionIds[0] === factionId ? treaty.factionIds[1] : treaty.factionIds[0];
    if (isTreatyArticleSuspended(state, articleId, factionId, partnerId)) continue;
    partners.add(partnerId);
  }
  return Array.from(partners);
}

export function normalizeTreatyArticleIds(articleIds: unknown): TreatyArticleId[] {
  const normalized: TreatyArticleId[] = [];
  if (!Array.isArray(articleIds)) return normalized;
  for (const articleId of articleIds) {
    if (articleId !== TRADE_PRIVILEGE_ARTICLE_ID && articleId !== MIGRATION_PACT_ARTICLE_ID) continue;
    if (!normalized.includes(articleId)) normalized.push(articleId);
  }
  return normalized;
}

export function normalizePeaceTerms(terms: unknown): DiplomacyPeaceTerms {
  const raw = isRecord(terms) ? terms : {};
  const mode: PeaceMode = raw.mode === "statusQuo" ? "statusQuo" : "whitePeace";
  const transfers = Array.isArray(raw.transfers)
    ? raw.transfers
      .filter(isRecord)
      .map<DiplomacySystemTransferTerm | null>((transfer) => {
        const starbaseId = typeof transfer.starbaseId === "string" ? transfer.starbaseId.trim() : "";
        const fromFactionId = Number(transfer.fromFactionId);
        const toFactionId = Number(transfer.toFactionId);
        if (!starbaseId || !Number.isInteger(fromFactionId) || !Number.isInteger(toFactionId) || fromFactionId === toFactionId) return null;
        return { starbaseId, fromFactionId, toFactionId };
      })
      .filter((transfer): transfer is DiplomacySystemTransferTerm => transfer !== null)
    : [];
  return {
    mode,
    transfers,
    enforcedArticleIds: normalizeTreatyArticleIds(raw.enforcedArticleIds),
    enforcedDurationYears: clampTreatyDurationYears(raw.enforcedDurationYears),
  };
}

function normalizeBorderPolicies(rawBorders: unknown, factionIds: number[]): DiplomacyBorderPolicy[] {
  const factionSet = new Set(factionIds);
  const policies = new Map<string, DiplomacyBorderPolicy>();
  if (Array.isArray(rawBorders)) {
    for (const raw of rawBorders) {
      if (!isRecord(raw)) continue;
      const ownerFactionId = Number(raw.ownerFactionId);
      const targetFactionId = Number(raw.targetFactionId);
      if (!factionSet.has(ownerFactionId) || !factionSet.has(targetFactionId) || ownerFactionId === targetFactionId) continue;
      policies.set(`${ownerFactionId}:${targetFactionId}`, {
        ownerFactionId,
        targetFactionId,
        policy: raw.policy === "open" ? "open" : "closed",
      });
    }
  }
  for (const ownerFactionId of factionIds) {
    for (const targetFactionId of factionIds) {
      if (ownerFactionId === targetFactionId) continue;
      const key = `${ownerFactionId}:${targetFactionId}`;
      if (!policies.has(key)) {
        policies.set(key, { ownerFactionId, targetFactionId, policy: "closed" });
      }
    }
  }
  return Array.from(policies.values()).sort((a, b) => (
    a.ownerFactionId - b.ownerFactionId || a.targetFactionId - b.targetFactionId
  ));
}

function createDefaultBorderPolicies(factionIds: number[]): DiplomacyBorderPolicy[] {
  return normalizeBorderPolicies([], normalizeFactionIds(factionIds));
}

function normalizeWars(rawWars: unknown, factionIds: number[]): DiplomacyWar[] {
  const factionSet = new Set(factionIds);
  if (!Array.isArray(rawWars)) return [];
  return rawWars
    .filter(isRecord)
    .map<DiplomacyWar | null>((raw, index) => {
      const attackerFactionId = Number(raw.attackerFactionId);
      const defenderFactionId = Number(raw.defenderFactionId);
      if (!factionSet.has(attackerFactionId) || !factionSet.has(defenderFactionId) || attackerFactionId === defenderFactionId) return null;
      return {
        id: normalizeId(raw.id, `war-${index + 1}`),
        attackerFactionId,
        defenderFactionId,
        startedAtYear: normalizeYear(raw.startedAtYear),
        endedAtYear: normalizeNullableYear(raw.endedAtYear),
        preWarOwnership: normalizeOwnershipSnapshot(raw.preWarOwnership),
      };
    })
    .filter((war): war is DiplomacyWar => war !== null);
}

function normalizeTreaties(rawTreaties: unknown, factionIds: number[]): DiplomacyTreaty[] {
  const factionSet = new Set(factionIds);
  if (!Array.isArray(rawTreaties)) return [];
  return rawTreaties
    .filter(isRecord)
    .map<DiplomacyTreaty | null>((raw, index) => {
      const first = Number(Array.isArray(raw.factionIds) ? raw.factionIds[0] : raw.factionAId);
      const second = Number(Array.isArray(raw.factionIds) ? raw.factionIds[1] : raw.factionBId);
      if (!factionSet.has(first) || !factionSet.has(second) || first === second) return null;
      const articleIds = normalizeTreatyArticleIds(raw.articleIds);
      if (articleIds.length === 0) return null;
      const pair = normalizePair(first, second);
      const startedAtYear = normalizeYear(raw.startedAtYear);
      return {
        id: normalizeId(raw.id, `treaty-${index + 1}`),
        factionIds: pair,
        articleIds,
        proposedByFactionId: factionSet.has(Number(raw.proposedByFactionId)) ? Number(raw.proposedByFactionId) : pair[0],
        acceptedByFactionId: factionSet.has(Number(raw.acceptedByFactionId)) ? Number(raw.acceptedByFactionId) : pair[1],
        startedAtYear,
        minimumEndYear: Math.max(startedAtYear + TREATY_MIN_YEARS, normalizeYear(raw.minimumEndYear, startedAtYear + TREATY_DEFAULT_YEARS)),
        cancelledAtYear: normalizeNullableYear(raw.cancelledAtYear),
        earlyCancelled: raw.earlyCancelled === true,
        cancellationReason: typeof raw.cancellationReason === "string" ? raw.cancellationReason : null,
        replacedByTreatyId: typeof raw.replacedByTreatyId === "string" ? raw.replacedByTreatyId : null,
      };
    })
    .filter((treaty): treaty is DiplomacyTreaty => treaty !== null);
}

function normalizeProposals(rawProposals: unknown, factionIds: number[]): DiplomacyProposal[] {
  const factionSet = new Set(factionIds);
  if (!Array.isArray(rawProposals)) return [];
  return rawProposals
    .filter(isRecord)
    .map<DiplomacyProposal | null>((raw, index) => {
      const fromFactionId = Number(raw.fromFactionId);
      const toFactionId = Number(raw.toFactionId);
      if (!factionSet.has(fromFactionId) || !factionSet.has(toFactionId) || fromFactionId === toFactionId) return null;
      const kind: DiplomacyProposalKind = raw.kind === "peace" ? "peace" : "treaty";
      const articleIds = normalizeTreatyArticleIds(raw.articleIds);
      const peaceTerms = kind === "peace" ? normalizePeaceTerms(raw.peaceTerms) : null;
      if (kind === "treaty" && articleIds.length === 0) return null;
      return {
        id: normalizeId(raw.id, `${kind}-proposal-${index + 1}`),
        kind,
        fromFactionId,
        toFactionId,
        articleIds,
        durationYears: clampTreatyDurationYears(raw.durationYears),
        peaceTerms,
        status: PROPOSAL_STATUSES.includes(raw.status as DiplomacyProposalStatus) ? raw.status as DiplomacyProposalStatus : "pending",
        createdAtYear: normalizeYear(raw.createdAtYear),
        resolvedAtYear: normalizeNullableYear(raw.resolvedAtYear),
        responseByFactionId: factionSet.has(Number(raw.responseByFactionId)) ? Number(raw.responseByFactionId) : null,
        replacesTreatyId: typeof raw.replacesTreatyId === "string" ? raw.replacesTreatyId : null,
      };
    })
    .filter((proposal): proposal is DiplomacyProposal => proposal !== null);
}

function normalizeChatMessages(rawMessages: unknown, factionIds: number[]): DiplomacyChatMessage[] {
  const factionSet = new Set(factionIds);
  const byPair = new Map<string, DiplomacyChatMessage[]>();
  if (Array.isArray(rawMessages)) {
    rawMessages
      .filter(isRecord)
      .forEach((raw, index) => {
        const fromFactionId = Number(raw.fromFactionId);
        const toFactionId = Number(raw.toFactionId);
        if (!factionSet.has(fromFactionId) || !factionSet.has(toFactionId) || fromFactionId === toFactionId) return;
        const body = typeof raw.body === "string" ? raw.body.trim() : "";
        if (!body) return;
        const message: DiplomacyChatMessage = {
          id: normalizeId(raw.id, `diplomacy-message-${index + 1}`),
          fromFactionId,
          toFactionId,
          body,
          createdAtYear: normalizeYear(raw.createdAtYear),
        };
        const key = getDiplomacyPairKey(fromFactionId, toFactionId);
        const messages = byPair.get(key) ?? [];
        messages.push(message);
        byPair.set(key, messages);
      });
  }
  return Array.from(byPair.values())
    .flatMap((messages) => messages
      .sort((a, b) => a.createdAtYear - b.createdAtYear || a.id.localeCompare(b.id))
      .slice(-DIPLOMACY_CHAT_LIMIT_PER_PAIR))
    .sort((a, b) => a.createdAtYear - b.createdAtYear || a.id.localeCompare(b.id));
}

function normalizeOwnershipSnapshot(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  return value
    .map<[number, number] | null>((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return null;
      const starId = Number(entry[0]);
      const ownerId = Number(entry[1]);
      if (!Number.isInteger(starId) || starId < 0 || !Number.isInteger(ownerId)) return null;
      return [starId, ownerId];
    })
    .filter((entry): entry is [number, number] => entry !== null);
}

function normalizeFactionIds(factionIds: number[]): number[] {
  return Array.from(new Set(
    factionIds
      .map((factionId) => Number(factionId))
      .filter((factionId) => Number.isInteger(factionId)),
  )).sort((a, b) => a - b);
}

function normalizePair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

function pairMatches(a: number, b: number, candidateA: number, candidateB: number): boolean {
  return (a === candidateA && b === candidateB) || (a === candidateB && b === candidateA);
}

function normalizeId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeYear(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeNullableYear(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
