import type { AiObservation } from "./ai-observation";
import type { ActiveEpisode } from "./types";

/** Remember only our own borders, never the private global pre-war map. */
export function rememberWarBorders(observation: AiObservation, episode: ActiveEpisode) {
  const own = observation.snapshot.starOwnership.filter(([, owner]) => owner === observation.factionId).map(([starId]) => starId);
  const baselines = episode.warBaselineSystems ??= {};
  for (const war of observation.diplomacy.wars.filter((entry) => !entry.endedAtYear && [entry.attackerFactionId, entry.defenderFactionId].includes(observation.factionId))) {
    const rival = war.attackerFactionId === observation.factionId ? war.defenderFactionId : war.attackerFactionId;
    baselines[war.id] ??= baselines[`pending:${rival}`] ?? own;
    delete baselines[`pending:${rival}`];
  }
}

export function peaceAssessment(observation: AiObservation, episode: ActiveEpisode, rival: number, solvent: boolean, hasNavy: boolean) {
  const war = observation.diplomacy.wars.find((entry) => !entry.endedAtYear && [entry.attackerFactionId, entry.defenderFactionId].includes(rival)
    && [entry.attackerFactionId, entry.defenderFactionId].includes(observation.factionId));
  const owners = new Map(observation.snapshot.starOwnership);
  const baseline = war ? episode.warBaselineSystems?.[war.id] ?? [] : [];
  const gains = observation.snapshot.starOwnership.filter(([id, owner]) => owner === observation.factionId && !baseline.includes(id)).length;
  const losses = baseline.filter((id) => owners.get(id) !== observation.factionId).length;
  const strandedColony = observation.planets.planets.some(({ planetState }) => planetState.ownerId === observation.factionId
    && planetState.isHabited && owners.get(planetState.starId) !== observation.factionId);
  const power = (owner: number) => observation.fleets.ships.filter((ship) => ship.ownerId === owner && ["corvette", "destroyer", "cruiser", "battleship", "defensePlatform"].includes(ship.shipKind))
    .reduce((sum, ship) => sum + ship.hull + ship.armor + ship.shield, 0);
  const exhausted = !solvent || !hasNavy || power(rival) > power(observation.factionId) * 1.25;
  const prolonged = !!war && observation.snapshot.clock.year - war.startedAtYear >= 3;
  return { gains, losses, exhausted, prolonged,
    acceptStatusQuo: !!war && !strandedColony && (gains >= losses || exhausted),
    acceptWhitePeace: !!war && (gains <= losses || exhausted),
    proposeStatusQuo: !!war && !strandedColony && (gains > 0 && gains >= losses || exhausted) };
}
