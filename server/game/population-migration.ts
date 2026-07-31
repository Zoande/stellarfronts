import {
  JOB_CLASS_BY_KIND,
  getEffectiveSpeciesHabitability,
  sumSpeciesPopulation,
} from "../../src/data/Economy";
import type { JobClass, JobKind, PlanetState, PopGroup, SpeciesPopulation } from "../../src/data/Economy";
import { MIN_HABITED_POPULATION } from "../../src/data/Population";
import { canRightsWorkJob } from "../../src/data/Species";
import type { SpeciesId } from "../../src/data/Species";
import {
  MIGRATION_PACT_ARTICLE_ID,
  getActiveTreatyPartnersForArticle,
} from "../../src/data/Diplomacy";
import { applyPlanetStatesToStars } from "../../src/data/StarMap";
import { computeJumpDistances, getMigrationDistanceMultiplier } from "./pure-helpers";
import { MIGRATION_DISTANCE_MAX_JUMPS } from "./constants";
import {
  getPlanetSpeciesContext,
  getSpeciesRightsForFaction,
} from "./state-queries";
import type { RuntimeContext } from "./types";

const PRODUCTIVE_JOBS: JobKind[] = [
  "ruler",
  "administrator",
  "researcher",
  "artisan",
  "metallurgist",
  "entertainer",
  "enforcer",
  "farmer",
  "miner",
  "technician",
  "clerk",
];

interface MigrationProfile {
  index: number;
  planet: PlanetState;
  ownerId: number;
  attractiveness: number;
  intakeRemaining: number;
  vacancies: Record<JobClass, number>;
}

interface MigrationCohort {
  id: string;
  source: MigrationProfile;
  speciesId: SpeciesId;
  job: JobKind;
  jobClass: JobClass;
  priority: number;
  remaining: number;
}

interface MigrationEdge {
  cohort: MigrationCohort;
  target: MigrationProfile;
  vacancyClass: JobClass;
  weight: number;
}

interface WeightedAllocation<T> {
  item: T;
  weight: number;
  cap: number;
}

function proportionalWaterFill<T>(entries: WeightedAllocation<T>[], rawBudget: number): Array<{ item: T; amount: number }> {
  const budget = Math.max(0, Math.floor(rawBudget));
  const active = entries
    .filter((entry) => entry.weight > 0 && entry.cap > 0)
    .map((entry) => ({ ...entry, cap: Math.floor(entry.cap), amount: 0 }))
    .sort((a, b) => String((a.item as { id?: string }).id ?? "").localeCompare(String((b.item as { id?: string }).id ?? "")));
  let remaining = Math.min(budget, active.reduce((sum, entry) => sum + entry.cap, 0));
  while (remaining > 0 && active.some((entry) => entry.amount < entry.cap)) {
    const eligible = active.filter((entry) => entry.amount < entry.cap);
    const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0) break;
    const exact = eligible.map((entry) => {
      const available = entry.cap - entry.amount;
      const share = Math.min(available, remaining * entry.weight / totalWeight);
      return { entry, share, floor: Math.floor(share) };
    });
    let assigned = 0;
    for (const allocation of exact) {
      allocation.entry.amount += allocation.floor;
      assigned += allocation.floor;
    }
    let leftover = Math.min(
      remaining - assigned,
      exact.reduce((sum, allocation) => sum + Math.max(0, allocation.entry.cap - allocation.entry.amount), 0),
    );
    exact
      .sort((a, b) => (
        (b.share - b.floor) - (a.share - a.floor)
        || String((a.entry.item as { id?: string }).id ?? "").localeCompare(String((b.entry.item as { id?: string }).id ?? ""))
      ))
      .forEach((allocation) => {
        if (leftover <= 0 || allocation.entry.amount >= allocation.entry.cap) return;
        allocation.entry.amount += 1;
        leftover -= 1;
      });
    const used = assigned + (remaining - assigned - leftover);
    if (used <= 0) break;
    remaining -= used;
  }
  return active.filter((entry) => entry.amount > 0).map((entry) => ({ item: entry.item, amount: entry.amount }));
}

function calculateVacancies(planet: PlanetState): Record<JobClass, number> {
  const occupied = new Map<JobKind, number>();
  for (const group of planet.economy.popGroups) {
    if (!PRODUCTIVE_JOBS.includes(group.job)) continue;
    occupied.set(group.job, (occupied.get(group.job) ?? 0) + group.population);
  }
  const result: Record<JobClass, number> = { lower: 0, middle: 0, upper: 0 };
  for (const job of PRODUCTIVE_JOBS) {
    const vacancy = Math.max(0, planet.economy.jobCapacity[job] - (occupied.get(job) ?? 0));
    result[JOB_CLASS_BY_KIND[job]] += vacancy;
  }
  return result;
}

function createProfiles(ctx: RuntimeContext): MigrationProfile[] {
  return ctx.state.planetStates
    .map((planet, index): MigrationProfile | null => {
      const ownerId = planet.ownerId ?? -1;
      if (!planet.isHabited || ownerId < 0) return null;
      return {
        index,
        planet,
        ownerId,
        attractiveness: planet.economy.migration.attractiveness,
        intakeRemaining: planet.economy.migration.monthlyIntakeCapacity,
        vacancies: calculateVacancies(planet),
      };
    })
    .filter((profile): profile is MigrationProfile => profile !== null)
    .sort((a, b) => a.planet.id.localeCompare(b.planet.id));
}

function getCohortPriority(group: PopGroup): number {
  if (group.job === "unemployed") return 0;
  if (group.class === "lower") return 1;
  if (group.class === "middle") return 2;
  return 3;
}

function createCohorts(profiles: MigrationProfile[]): MigrationCohort[] {
  return profiles
    .flatMap((source) => source.planet.economy.popGroups.map((group, index): MigrationCohort => ({
      id: `${source.planet.id}:${getCohortPriority(group)}:${group.speciesId}:${group.job}:${index}`,
      source,
      speciesId: group.speciesId,
      job: group.job,
      jobClass: group.class,
      priority: getCohortPriority(group),
      remaining: group.population,
    })))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function isRelationEligible(ctx: RuntimeContext, cohort: MigrationCohort, target: MigrationProfile): boolean {
  const sourceRights = getSpeciesRightsForFaction(ctx.state, cohort.source.ownerId, cohort.speciesId);
  const targetRights = getSpeciesRightsForFaction(ctx.state, target.ownerId, cohort.speciesId);
  if (cohort.source.ownerId === target.ownerId) {
    return sourceRights.migration !== "notAllowed" && targetRights.migration !== "notAllowed";
  }
  if (sourceRights.migration !== "free" || targetRights.migration !== "free") return false;
  return getActiveTreatyPartnersForArticle(
    ctx.state.diplomacy,
    cohort.source.ownerId,
    MIGRATION_PACT_ARTICLE_ID,
  ).includes(target.ownerId);
}

function getThreshold(cohort: MigrationCohort): number {
  if (cohort.job === "unemployed") return 0;
  if (cohort.jobClass === "lower") return 10;
  if (cohort.jobClass === "middle") return 20;
  return 30;
}

function getCompatibleVacancyClasses(
  ctx: RuntimeContext,
  cohort: MigrationCohort,
  target: MigrationProfile,
): JobClass[] {
  const targetRights = getSpeciesRightsForFaction(ctx.state, target.ownerId, cohort.speciesId);
  if (cohort.job !== "unemployed") {
    return target.vacancies[cohort.jobClass] > 0 && canRightsWorkJob(targetRights, cohort.jobClass)
      ? [cohort.jobClass]
      : [];
  }
  return (["lower", "middle", "upper"] as JobClass[])
    .filter((jobClass) => target.vacancies[jobClass] > 0 && canRightsWorkJob(targetRights, jobClass));
}

function buildEdges(ctx: RuntimeContext, cohorts: MigrationCohort[], targets: MigrationProfile[]): MigrationEdge[] {
  const distanceCache = new Map<string, Map<number, number>>();
  const edges: MigrationEdge[] = [];
  for (const cohort of cohorts) {
    if (cohort.remaining <= 0) continue;
    const sourceFloorRoom = Math.max(0, cohort.source.planet.population - MIN_HABITED_POPULATION);
    if (sourceFloorRoom <= 0) continue;
    let distances = distanceCache.get(cohort.source.planet.id);
    if (!distances) {
      distances = computeJumpDistances(
        ctx.state.adjacency,
        cohort.source.planet.starId,
        MIGRATION_DISTANCE_MAX_JUMPS,
      );
      distanceCache.set(cohort.source.planet.id, distances);
    }
    for (const target of targets) {
      if (target.index === cohort.source.index || target.intakeRemaining <= 0) continue;
      if (!isRelationEligible(ctx, cohort, target)) continue;
      const improvement = target.attractiveness - cohort.source.attractiveness;
      if (cohort.job !== "unemployed" && improvement < getThreshold(cohort)) continue;
      const habitability = getEffectiveSpeciesHabitability(
        target.planet,
        cohort.speciesId,
        getPlanetSpeciesContext(ctx.state, target.planet),
      );
      if (habitability < 20) continue;
      const distanceWeight = getMigrationDistanceMultiplier(distances, target.planet.starId);
      if (distanceWeight <= 0) continue;
      const classes = getCompatibleVacancyClasses(ctx, cohort, target);
      if (classes.length === 0) continue;
      const vacancyClass = classes.sort((a, b) => (
        target.vacancies[b] - target.vacancies[a] || a.localeCompare(b)
      ))[0];
      const attractionWeight = cohort.job === "unemployed"
        ? Math.max(1, target.attractiveness)
        : Math.max(1, improvement - getThreshold(cohort) + 1);
      edges.push({
        cohort,
        target,
        vacancyClass,
        weight: attractionWeight * Math.max(0.2, habitability / 100) * distanceWeight,
      });
    }
  }
  return edges;
}

function applySpeciesDelta(
  populations: SpeciesPopulation[],
  speciesId: SpeciesId,
  delta: number,
): SpeciesPopulation[] {
  const bySpecies = new Map(populations.map((entry) => [entry.speciesId, entry.population]));
  bySpecies.set(speciesId, Math.max(0, (bySpecies.get(speciesId) ?? 0) + delta));
  return [...bySpecies.entries()]
    .filter(([, population]) => population > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([nextSpeciesId, population]) => ({ speciesId: nextSpeciesId, population }));
}

export function processMonthlyMigration(ctx: RuntimeContext, monthIndex: number): boolean {
  const profiles = createProfiles(ctx);
  const cohorts = createCohorts(profiles);
  const inbound = new Map<number, number>();
  const outbound = new Map<number, number>();
  const speciesDeltas = new Map<number, Map<SpeciesId, number>>();
  const sourceRemaining = new Map(profiles.map((profile) => [
    profile.index,
    Math.max(0, profile.planet.population - MIN_HABITED_POPULATION),
  ]));

  const addFlow = (cohort: MigrationCohort, target: MigrationProfile, vacancyClass: JobClass, amount: number): void => {
    const flow = Math.max(0, Math.floor(amount));
    if (flow <= 0) return;
    cohort.remaining -= flow;
    sourceRemaining.set(cohort.source.index, (sourceRemaining.get(cohort.source.index) ?? 0) - flow);
    target.intakeRemaining -= flow;
    target.vacancies[vacancyClass] -= flow;
    inbound.set(target.index, (inbound.get(target.index) ?? 0) + flow);
    outbound.set(cohort.source.index, (outbound.get(cohort.source.index) ?? 0) + flow);
    for (const [planetIndex, delta] of [[cohort.source.index, -flow], [target.index, flow]] as const) {
      const deltas = speciesDeltas.get(planetIndex) ?? new Map<SpeciesId, number>();
      deltas.set(cohort.speciesId, (deltas.get(cohort.speciesId) ?? 0) + delta);
      speciesDeltas.set(planetIndex, deltas);
    }
  };

  for (let priority = 0; priority <= 3; priority += 1) {
    const tierCohorts = cohorts.filter((cohort) => cohort.priority === priority);
    for (let pass = 0; pass < 8; pass += 1) {
      const edges = buildEdges(ctx, tierCohorts, profiles);
      if (edges.length === 0) break;
      const proposals: Array<{ id: string; edge: MigrationEdge; amount: number }> = [];
      for (const cohort of tierCohorts) {
        const cohortEdges = edges.filter((edge) => edge.cohort === cohort);
        const budget = Math.min(cohort.remaining, sourceRemaining.get(cohort.source.index) ?? 0);
        const allocations = proportionalWaterFill(
          cohortEdges.map((edge) => ({
            item: { id: `${edge.target.planet.id}:${edge.vacancyClass}`, edge },
            weight: edge.weight,
            cap: Math.min(edge.target.intakeRemaining, edge.target.vacancies[edge.vacancyClass]),
          })),
          budget,
        );
        for (const allocation of allocations) {
          proposals.push({
            id: `${allocation.item.edge.target.planet.id}:${allocation.item.edge.vacancyClass}:${cohort.id}`,
            edge: allocation.item.edge,
            amount: allocation.amount,
          });
        }
      }
      if (proposals.length === 0) break;
      let movedThisPass = 0;
      for (const target of profiles) {
        for (const vacancyClass of ["lower", "middle", "upper"] as JobClass[]) {
          const targetProposals = proposals.filter(
            (proposal) => proposal.edge.target === target && proposal.edge.vacancyClass === vacancyClass,
          );
          const budget = Math.min(target.intakeRemaining, target.vacancies[vacancyClass]);
          const accepted = proportionalWaterFill(
            targetProposals.map((proposal) => ({
              item: proposal,
              weight: proposal.edge.weight,
              cap: Math.min(
                proposal.amount,
                proposal.edge.cohort.remaining,
                sourceRemaining.get(proposal.edge.cohort.source.index) ?? 0,
              ),
            })),
            budget,
          );
          for (const allocation of accepted) {
            addFlow(allocation.item.edge.cohort, target, vacancyClass, allocation.amount);
            movedThisPass += allocation.amount;
          }
        }
      }
      if (movedThisPass <= 0) break;
    }
  }

  ctx.state.planetStates = ctx.state.planetStates.map((planet, index) => {
    let speciesPopulations = planet.speciesPopulations.map((entry) => ({ ...entry }));
    const deltas = speciesDeltas.get(index);
    if (deltas) {
      for (const [speciesId, delta] of [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        speciesPopulations = applySpeciesDelta(speciesPopulations, speciesId, delta);
      }
    }
    const population = sumSpeciesPopulation(speciesPopulations);
    const next = {
      ...planet,
      population,
      speciesPopulations,
      populationMigration: {
        monthIndex,
        inbound: inbound.get(index) ?? 0,
        outbound: outbound.get(index) ?? 0,
        intakeCapacity: planet.economy.migration.monthlyIntakeCapacity,
      },
    };
    if (planet.isHabited) ctx.queuePlanetDetailRefresh(planet.id);
    return next;
  });
  applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
  ctx.hasDirtyState = true;
  // The ledger's month and zero-valued flows are still a visible state change:
  // clients must never keep displaying an older nonzero migration month.
  return true;
}
