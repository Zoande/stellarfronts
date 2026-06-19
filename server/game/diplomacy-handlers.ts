// =============================================================================
// Diplomacy command handlers — extracted from server/index.ts
//
// The socket-facing diplomacy commands (messages, borders, war/peace, treaties)
// plus their domain logic (treaty creation/replacement, peace-term application).
// Handlers take (ctx, socket, perspective, …); they emit results via the pure
// socket helpers and fan out via ctx.broadcastUpdates. The dispatcher in
// index.ts routes ClientCommands to the exported handlers.
// =============================================================================

import type { WebSocket } from "ws";
import {
  normalizeDiplomacyState,
  setBorderPolicy,
  areFactionsAtWar,
  getActiveTreatiesBetween,
  getActiveWar,
  clampTreatyDurationYears,
  normalizeTreatyArticleIds,
  normalizePeaceTerms,
} from "../../src/data/Diplomacy";
import type {
  BorderPolicy,
  DiplomacyPeaceTerms,
  DiplomacyProposal,
  DiplomacySystemTransferTerm,
  DiplomacyTreaty,
  DiplomacyWar,
  TreatyArticleId,
} from "../../src/data/Diplomacy";
import type { FactionInfo, GalaxyPerspective } from "../../src/data/Factions";
import type { ServerUpdateField } from "../../src/game/GameProtocol";
import { reject, accept } from "./socket-io";
import { validateCommandPerspective, getStarbaseInSystem } from "./state-queries";
import { syncSystemOwnershipFromStarbases } from "./state-normalization";
import { toOwnershipEntries } from "./snapshot";
import type { RuntimeContext } from "./types";

// === EXTRACTED BODY BELOW (transformed for ctx-first signatures) ===
function getDiplomacyCommandFaction(ctx: RuntimeContext, socket: WebSocket, perspective: GalaxyPerspective): number | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return null;
  }
  if (!ctx.state.factions.some((faction) => faction.id === factionId)) {
    reject(socket, "Your country is not available.");
    return null;
  }
  return factionId;
}

function getDiplomacyTarget(ctx: RuntimeContext, socket: WebSocket, actorFactionId: number, targetFactionId: number): FactionInfo | null {
  if (!Number.isInteger(targetFactionId) || targetFactionId === actorFactionId) {
    reject(socket, "Select another country.");
    return null;
  }
  const target = ctx.state.factions.find((faction) => faction.id === targetFactionId);
  if (!target) {
    reject(socket, "Country not found.");
    return null;
  }
  return target;
}

function normalizeDiplomacyAfterMutation(ctx: RuntimeContext): void {
  const normalized = normalizeDiplomacyState(
    ctx.state.diplomacy,
    ctx.state.factions.map((faction) => faction.id),
  );
  ctx.state.diplomacy = normalized.state;
}

function commitDiplomacyChange(ctx: RuntimeContext, socket: WebSocket, message: string, changed: ServerUpdateField[] = ["diplomacy"]): void {
  normalizeDiplomacyAfterMutation(ctx);
  ctx.hasDirtyState = true;
  accept(socket, message);
  ctx.broadcastUpdates(changed);
}

export function handleSendDiplomacyMessage(ctx: RuntimeContext, 
  socket: WebSocket,
  perspective: GalaxyPerspective,
  targetFactionId: number,
  body: string,
): void {
  const factionId = getDiplomacyCommandFaction(ctx, socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(ctx, socket, factionId, Number(targetFactionId));
  if (!target) return;
  const normalizedBody = String(body ?? "").trim().slice(0, 500);
  if (!normalizedBody) return reject(socket, "Message is empty.");
  ctx.state.diplomacy.chatMessages.push({
    id: ctx.createRuntimeId("diplomacy-message", [factionId, target.id]),
    fromFactionId: factionId,
    toFactionId: target.id,
    body: normalizedBody,
    createdAtYear: ctx.state.clock.year,
  });
  commitDiplomacyChange(ctx, socket, "Message sent.");
}

export function handleSetBorderPolicy(ctx: RuntimeContext, 
  socket: WebSocket,
  perspective: GalaxyPerspective,
  targetFactionId: number,
  policy: BorderPolicy,
): void {
  const factionId = getDiplomacyCommandFaction(ctx, socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(ctx, socket, factionId, Number(targetFactionId));
  if (!target) return;
  const normalizedPolicy: BorderPolicy = policy === "open" ? "open" : "closed";
  setBorderPolicy(ctx.state.diplomacy, factionId, target.id, normalizedPolicy);
  commitDiplomacyChange(ctx, socket, `Borders ${normalizedPolicy === "open" ? "opened" : "closed"} to ${target.name}.`);
}

export function handleDeclareWar(ctx: RuntimeContext, socket: WebSocket, perspective: GalaxyPerspective, targetFactionId: number): void {
  const factionId = getDiplomacyCommandFaction(ctx, socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(ctx, socket, factionId, Number(targetFactionId));
  if (!target) return;
  if (areFactionsAtWar(ctx.state.diplomacy, factionId, target.id)) {
    return reject(socket, `You are already at war with ${target.name}.`);
  }
  ctx.state.diplomacy.wars.push({
    id: ctx.createRuntimeId("war", [factionId, target.id]),
    attackerFactionId: factionId,
    defenderFactionId: target.id,
    startedAtYear: ctx.state.clock.year,
    endedAtYear: null,
    preWarOwnership: toOwnershipEntries(ctx.state.starOwnership),
  });
  commitDiplomacyChange(ctx, 
    socket,
    `War declared on ${target.name}.`,
    ["diplomacy", "market", "fleets", "starbases", "combatContacts"],
  );
}

function getPendingDiplomacyProposal(ctx: RuntimeContext, proposalId: string): DiplomacyProposal | null {
  return ctx.state.diplomacy.proposals.find((proposal) => (
    proposal.id === proposalId && proposal.status === "pending"
  )) ?? null;
}

function createDiplomacyTreaty(ctx: RuntimeContext, 
  factionA: number,
  factionB: number,
  articleIds: TreatyArticleId[],
  proposedByFactionId: number,
  acceptedByFactionId: number,
  durationYears: number,
  id = ctx.createRuntimeId("treaty", [factionA, factionB]),
): DiplomacyTreaty {
  const factionIds: [number, number] = factionA < factionB ? [factionA, factionB] : [factionB, factionA];
  const startedAtYear = ctx.state.clock.year;
  return {
    id,
    factionIds,
    articleIds,
    proposedByFactionId,
    acceptedByFactionId,
    startedAtYear,
    minimumEndYear: startedAtYear + clampTreatyDurationYears(durationYears),
    cancelledAtYear: null,
    earlyCancelled: false,
    cancellationReason: null,
    replacedByTreatyId: null,
  };
}

function replaceOverlappingTreaties(ctx: RuntimeContext, nextTreaty: DiplomacyTreaty, requestedReplacesTreatyId?: string | null): void {
  const replacements = ctx.state.diplomacy.treaties.filter((treaty) => {
    if (Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)) return false;
    if (!getActiveTreatiesBetween(ctx.state.diplomacy, nextTreaty.factionIds[0], nextTreaty.factionIds[1]).includes(treaty)) return false;
    if (requestedReplacesTreatyId && treaty.id === requestedReplacesTreatyId) return true;
    return treaty.articleIds.some((articleId) => nextTreaty.articleIds.includes(articleId));
  });
  for (const treaty of replacements) {
    treaty.cancelledAtYear = ctx.state.clock.year;
    treaty.earlyCancelled = ctx.state.clock.year < treaty.minimumEndYear;
    treaty.cancellationReason = "renegotiated";
    treaty.replacedByTreatyId = nextTreaty.id;
  }
}

export function handleProposeTreaty(ctx: RuntimeContext, 
  socket: WebSocket,
  perspective: GalaxyPerspective,
  targetFactionId: number,
  articleIds: TreatyArticleId[],
  durationYears?: number,
  replacesTreatyId?: string | null,
): void {
  const factionId = getDiplomacyCommandFaction(ctx, socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(ctx, socket, factionId, Number(targetFactionId));
  if (!target) return;
  const normalizedArticleIds = normalizeTreatyArticleIds(articleIds);
  if (normalizedArticleIds.length === 0) return reject(socket, "Select at least one treaty article.");
  const normalizedDuration = clampTreatyDurationYears(durationYears);
  if (replacesTreatyId) {
    const treaty = ctx.state.diplomacy.treaties.find((candidate) => candidate.id === replacesTreatyId);
    if (
      !treaty
      || Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)
      || !getActiveTreatiesBetween(ctx.state.diplomacy, factionId, target.id).includes(treaty)
    ) {
      return reject(socket, "Treaty to renegotiate is not active.");
    }
  }
  ctx.state.diplomacy.proposals.push({
    id: ctx.createRuntimeId("treaty-proposal", [factionId, target.id]),
    kind: "treaty",
    fromFactionId: factionId,
    toFactionId: target.id,
    articleIds: normalizedArticleIds,
    durationYears: normalizedDuration,
    peaceTerms: null,
    status: "pending",
    createdAtYear: ctx.state.clock.year,
    resolvedAtYear: null,
    responseByFactionId: null,
    replacesTreatyId: replacesTreatyId ?? null,
  });
  commitDiplomacyChange(ctx, socket, `Treaty proposed to ${target.name}.`);
}

function cancelOtherPendingPeaceProposals(ctx: RuntimeContext, war: DiplomacyWar, acceptedProposalId: string): void {
  for (const proposal of ctx.state.diplomacy.proposals) {
    if (
      proposal.id !== acceptedProposalId
      && proposal.kind === "peace"
      && proposal.status === "pending"
      && (
        (proposal.fromFactionId === war.attackerFactionId && proposal.toFactionId === war.defenderFactionId)
        || (proposal.fromFactionId === war.defenderFactionId && proposal.toFactionId === war.attackerFactionId)
      )
    ) {
      proposal.status = "cancelled";
      proposal.resolvedAtYear = ctx.state.clock.year;
    }
  }
}

function applyPeaceTerms(ctx: RuntimeContext, war: DiplomacyWar, proposal: DiplomacyProposal, responseFactionId: number): ServerUpdateField[] {
  const terms = normalizePeaceTerms(proposal.peaceTerms);
  const participants = new Set([war.attackerFactionId, war.defenderFactionId]);
  if (terms.mode === "whitePeace") {
    for (const [starId, ownerId] of war.preWarOwnership) {
      if (!participants.has(ownerId)) continue;
      const starbase = getStarbaseInSystem(ctx, starId);
      if (!starbase || !participants.has(starbase.ownerId)) continue;
      starbase.ownerId = ownerId;
    }
  }

  for (const transfer of terms.transfers) {
    if (!isValidPeaceTransferTerm(ctx, transfer, war)) continue;
    const starbase = ctx.state.starbases.find((candidate) => candidate.id === transfer.starbaseId);
    if (!starbase || starbase.ownerId !== transfer.fromFactionId) continue;
    starbase.ownerId = transfer.toFactionId;
  }

  war.endedAtYear = ctx.state.clock.year;
  cancelOtherPendingPeaceProposals(ctx, war, proposal.id);

  if (terms.enforcedArticleIds.length > 0) {
    const treaty = createDiplomacyTreaty(ctx, 
      war.attackerFactionId,
      war.defenderFactionId,
      terms.enforcedArticleIds,
      proposal.fromFactionId,
      responseFactionId,
      terms.enforcedDurationYears,
    );
    replaceOverlappingTreaties(ctx, treaty, null);
    ctx.state.diplomacy.treaties.push(treaty);
  }

  syncSystemOwnershipFromStarbases(ctx.state);
  ctx.recalculatePlanetEconomies();
  ctx.refreshFactionEconomyDeltas();
  ctx.refreshDiscovery();
  return ["diplomacy", "starbases", "visibility", "planetStates", "factionEconomies", "market", "fleets", "combatContacts"];
}

export function handleRespondDiplomacyProposal(ctx: RuntimeContext, 
  socket: WebSocket,
  perspective: GalaxyPerspective,
  proposalId: string,
  response: "accept" | "decline",
): void {
  const factionId = getDiplomacyCommandFaction(ctx, socket, perspective);
  if (factionId === null) return;
  const proposal = getPendingDiplomacyProposal(ctx, String(proposalId ?? ""));
  if (!proposal) return reject(socket, "Proposal is not pending.");
  if (proposal.toFactionId !== factionId) return reject(socket, "Only the recipient can respond to this proposal.");
  if (response !== "accept") {
    proposal.status = "declined";
    proposal.resolvedAtYear = ctx.state.clock.year;
    proposal.responseByFactionId = factionId;
    return commitDiplomacyChange(ctx, socket, "Proposal declined.");
  }

  let changed: ServerUpdateField[] = ["diplomacy", "market"];
  if (proposal.kind === "treaty") {
    const treaty = createDiplomacyTreaty(ctx, 
      proposal.fromFactionId,
      proposal.toFactionId,
      proposal.articleIds,
      proposal.fromFactionId,
      factionId,
      proposal.durationYears,
    );
    replaceOverlappingTreaties(ctx, treaty, proposal.replacesTreatyId);
    ctx.state.diplomacy.treaties.push(treaty);
  } else {
    const war = getActiveWar(ctx.state.diplomacy, proposal.fromFactionId, proposal.toFactionId);
    if (!war) return reject(socket, "There is no active war to end.");
    changed = applyPeaceTerms(ctx, war, proposal, factionId);
  }

  proposal.status = "accepted";
  proposal.resolvedAtYear = ctx.state.clock.year;
  proposal.responseByFactionId = factionId;
  commitDiplomacyChange(ctx, socket, proposal.kind === "peace" ? "Peace accepted." : "Treaty accepted.", changed);
}

export function handleCancelDiplomacyProposal(ctx: RuntimeContext, socket: WebSocket, perspective: GalaxyPerspective, proposalId: string): void {
  const factionId = getDiplomacyCommandFaction(ctx, socket, perspective);
  if (factionId === null) return;
  const proposal = getPendingDiplomacyProposal(ctx, String(proposalId ?? ""));
  if (!proposal) return reject(socket, "Proposal is not pending.");
  if (proposal.fromFactionId !== factionId) return reject(socket, "Only the proposer can cancel this proposal.");
  proposal.status = "cancelled";
  proposal.resolvedAtYear = ctx.state.clock.year;
  proposal.responseByFactionId = factionId;
  commitDiplomacyChange(ctx, socket, "Proposal cancelled.");
}

export function handleCancelTreaty(ctx: RuntimeContext, socket: WebSocket, perspective: GalaxyPerspective, treatyId: string): void {
  const factionId = getDiplomacyCommandFaction(ctx, socket, perspective);
  if (factionId === null) return;
  const treaty = ctx.state.diplomacy.treaties.find((candidate) => candidate.id === String(treatyId ?? ""));
  if (!treaty || Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)) return reject(socket, "Active treaty not found.");
  if (treaty.factionIds[0] !== factionId && treaty.factionIds[1] !== factionId) {
    return reject(socket, "You are not part of this treaty.");
  }
  const partnerId = treaty.factionIds[0] === factionId ? treaty.factionIds[1] : treaty.factionIds[0];
  const war = getActiveWar(ctx.state.diplomacy, factionId, partnerId);
  treaty.cancelledAtYear = ctx.state.clock.year;
  treaty.earlyCancelled = ctx.state.clock.year < treaty.minimumEndYear;
  treaty.cancellationReason = war?.defenderFactionId === factionId ? "defenderWarCancel" : treaty.earlyCancelled ? "earlyCancellation" : "cancelled";
  commitDiplomacyChange(ctx, socket, "Treaty cancelled.", ["diplomacy", "market"]);
}

function isValidPeaceTransferTerm(ctx: RuntimeContext, transfer: DiplomacySystemTransferTerm, war: DiplomacyWar): boolean {
  const participants = new Set([war.attackerFactionId, war.defenderFactionId]);
  if (!participants.has(transfer.fromFactionId) || !participants.has(transfer.toFactionId)) return false;
  if (transfer.fromFactionId === transfer.toFactionId) return false;
  const starbase = ctx.state.starbases.find((candidate) => candidate.id === transfer.starbaseId);
  return !!starbase && starbase.ownerId === transfer.fromFactionId;
}

function validatePeaceTerms(ctx: RuntimeContext, socket: WebSocket, war: DiplomacyWar, terms: DiplomacyPeaceTerms): DiplomacyPeaceTerms | null {
  const normalized = normalizePeaceTerms(terms);
  const participants = new Set([war.attackerFactionId, war.defenderFactionId]);
  for (const transfer of normalized.transfers) {
    if (!participants.has(transfer.fromFactionId) || !participants.has(transfer.toFactionId)) {
      reject(socket, "Peace transfer must stay between war participants.");
      return null;
    }
    if (!ctx.state.starbases.some((starbase) => starbase.id === transfer.starbaseId)) {
      reject(socket, "Peace transfer starbase not found.");
      return null;
    }
  }
  return normalized;
}

export function handleProposePeace(ctx: RuntimeContext, 
  socket: WebSocket,
  perspective: GalaxyPerspective,
  targetFactionId: number,
  terms: DiplomacyPeaceTerms,
): void {
  const factionId = getDiplomacyCommandFaction(ctx, socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(ctx, socket, factionId, Number(targetFactionId));
  if (!target) return;
  const war = getActiveWar(ctx.state.diplomacy, factionId, target.id);
  if (!war) return reject(socket, `You are not at war with ${target.name}.`);
  const normalizedTerms = validatePeaceTerms(ctx, socket, war, terms);
  if (!normalizedTerms) return;
  const existing = ctx.state.diplomacy.proposals.some((proposal) => (
    proposal.kind === "peace"
    && proposal.status === "pending"
    && (
      (proposal.fromFactionId === factionId && proposal.toFactionId === target.id)
      || (proposal.fromFactionId === target.id && proposal.toFactionId === factionId)
    )
  ));
  if (existing) return reject(socket, "A peace proposal is already pending.");
  ctx.state.diplomacy.proposals.push({
    id: ctx.createRuntimeId("peace-proposal", [factionId, target.id]),
    kind: "peace",
    fromFactionId: factionId,
    toFactionId: target.id,
    articleIds: normalizedTerms.enforcedArticleIds,
    durationYears: normalizedTerms.enforcedDurationYears,
    peaceTerms: normalizedTerms,
    status: "pending",
    createdAtYear: ctx.state.clock.year,
    resolvedAtYear: null,
    responseByFactionId: null,
    replacesTreatyId: null,
  });
  commitDiplomacyChange(ctx, socket, `Peace proposed to ${target.name}.`);
}
