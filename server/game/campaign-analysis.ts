import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import type { AiDecisionRecord } from "./ai-diagnostics";
import type { CampaignSample } from "./active-lab";

async function eachLine(filename: string, visit: (row: any) => void) {
  const compressed = path.join(path.dirname(filename), "logs"), prefix = path.basename(filename, ".jsonl") + "-";
  const files = existsSync(filename) ? [filename] : existsSync(compressed) ? readdirSync(compressed)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".jsonl.gz")).sort().map((name) => path.join(compressed, name)) : [];
  for (const file of files) {
    const source = createReadStream(file);
    const input = file.endsWith(".gz") ? source.pipe(createGunzip()) : source;
    if (input !== source) source.on("error", (error) => input.destroy(error));
    for await (const line of createInterface({ input, crlfDelay: Infinity })) if (line.trim()) visit(JSON.parse(line));
  }
}

/** Stream the largest logs so multi-decade experiments do not require loading
 * hundreds of thousands of observations into memory at once. */
export async function analyzeCampaign(directory: string) {
  const run = JSON.parse(readFileSync(path.join(directory, "run.json"), "utf8"));
  const countries: Record<number, {
    mode?: string;
    turns: number; idle: number; importBacked: number; threatened: number; recovery: number;
    runwayBelowThree: Record<string, number>; importEnergy: number; exportEnergy: number; fees: number;
    importsByResource: Record<string, number>; exportsByResource: Record<string, number>;
    actions: Record<string, number>; rejected: Record<string, number>; milestones: Record<string, number>;
    opportunities: Record<string, number>;
  }> = {};
  const country = (id: number) => countries[id] ??= { turns: 0, idle: 0, importBacked: 0, threatened: 0, recovery: 0,
    runwayBelowThree: {}, importEnergy: 0, exportEnergy: 0, fees: 0, importsByResource: {}, exportsByResource: {}, actions: {}, rejected: {}, milestones: {}, opportunities: {} };
  const increment = (record: Record<string, number>, key: string, amount = 1) => record[key] = (record[key] ?? 0) + amount;
  await eachLine(path.join(directory, "decisions.jsonl"), (row: AiDecisionRecord & { day: number }) => {
    const result = country(row.factionId); result.turns++;
    result.mode = row.mode;
    if (!row.selected.length) result.idle++; if (row.trade.sustainable && row.trade.imports > 0) result.importBacked++;
    if (row.visibleThreat) result.threatened++;
    if (row.selected.some((action) => ["setPlanetBuildingEnabled", "setPlanetJobLock", "setUrbanSubDistrict"].includes(action.type))) result.recovery++;
    for (const [resource, months] of Object.entries(row.runwayMonths)) if (months !== null && months < 3) increment(result.runwayBelowThree, resource);
    for (const opportunity of row.localOpportunities) increment(result.opportunities, opportunity.reason);
  });
  await eachLine(path.join(directory, "actions.jsonl"), (row) => {
    const result = country(row.factionId);
    if (row.outcome.ok) { increment(result.actions, row.action.type); result.milestones["accepted:" + row.action.type] ??= row.day; }
    else increment(result.rejected, row.action.type + ": " + row.outcome.message);
  });
  await eachLine(path.join(directory, "market.jsonl"), (row) => {
    const result = country(row.playerId); result.fees += row.feePaid;
    if (row.totalEnergyDelta < 0) { result.importEnergy -= row.totalEnergyDelta; increment(result.importsByResource, row.resourceId, row.amount); }
    else { result.exportEnergy += row.totalEnergyDelta; increment(result.exportsByResource, row.resourceId, row.amount); }
  });
  const development: Record<string, number> = {}, performance: Record<string, { ticks: number; virtualDays: number; runtimeMs: number }> = {};
  await eachLine(path.join(directory, "development.jsonl"), (row) => {
    increment(development, row.type);
    const id = row.factionId ?? row.ownerId ?? row.ship?.ownerId ?? row.army?.ownerId ?? row.project?.ownerId;
    if (id !== undefined && id !== null) country(id).milestones[row.type] ??= row.day;
  });
  let days = 0, runtimeMs = 0;
  await eachLine(path.join(directory, "performance.jsonl"), (row) => {
    const result = performance[row.reason] ??= { ticks: 0, virtualDays: 0, runtimeMs: 0 };
    result.ticks++; result.virtualDays += row.elapsedDays; result.runtimeMs += row.runtimeMs;
    days = Math.max(days, row.day); runtimeMs += row.runtimeMs;
  });
  const events: Record<string, number> = {};
  await eachLine(path.join(directory, "events.jsonl"), (row) => {
    increment(events, row.type);
    if (row.type === "ownership" && row.to >= 0) country(row.to).milestones["system-gained"] ??= row.day;
  });
  const snapshots: CampaignSample[] = [];
  let first: CampaignSample | undefined, last: CampaignSample | undefined;
  let annualBucket = -1;
  await eachLine(path.join(directory, "timeline.jsonl"), (row: CampaignSample) => {
    first ??= row; last = row;
    const bucket = Math.floor((row.day + 1e-6) / 360);
    if (bucket > annualBucket) { snapshots.push(row); annualBucket = bucket; }
  });
  if (last && snapshots.at(-1)?.day !== last.day) snapshots.push(last);
  const pace = snapshots.map((snapshot, index) => ({ day: snapshot.day, year: snapshot.year,
    intervalDays: index ? snapshot.day - snapshots[index - 1].day : 0,
    factions: snapshot.factions.map((faction) => {
      const before = (index ? snapshots[index - 1] : snapshot).factions.find((entry) => entry.id === faction.id)!;
      return { factionId: faction.id, mode: faction.mode, systems: faction.systems, colonies: faction.colonies,
        ships: faction.ships, technologies: faction.technologies, crew: faction.crew, militaryPower: faction.militaryPower,
        population: faction.population, researchIncome: faction.researchIncome, queues: faction.queues,
        systemChange: faction.systems - before.systems, newTechnologies: faction.technologies - before.technologies,
        importSpending: faction.imports - before.imports, exportReceipts: faction.exports - before.exports };
    }) }));
  const analysis = { status: run.status, options: run.options, days, integrationRuntimeMs: runtimeMs,
    note: "Turn fractions describe decisions, not duration; resource runway excludes forecast trade. Import spending includes fees, export receipts are net of fees. Queue removal does not distinguish completion/cancellation. Ship removal is not automatically a combat loss. Milestones are relative to this run's initial checkpoint.",
    countries: Object.fromEntries(Object.entries(countries).map(([id, value]) => [id, { ...value,
      idleFraction: value.idle / Math.max(1, value.turns), sustainableImportFraction: value.importBacked / Math.max(1, value.turns),
      netTradeEnergy: value.exportEnergy - value.importEnergy, actionsPerYear: Object.values(value.actions).reduce((sum, count) => sum + count, 0) / Math.max(1 / 360, days / 360) }])),
    initialYear: first?.year, finalYear: last?.year, pace, development, events, performance };
  writeFileSync(path.join(directory, "analysis.json"), JSON.stringify(analysis, null, 2));
  const report = ["# Campaign pacing and trade", "",
    `Status: ${run.status}. Observed ${days.toFixed(1)} game days, from year ${first?.year.toFixed(2)} to ${last?.year.toFixed(2)}.`, "",
    "This analysis uses actual accepted commands, realized market transactions, and monthly snapshots. Forecast-funded import turns indicate potential trade capacity, not proof of actual exports. Idle percentages count controller turns rather than elapsed time. Milestones are relative to this continuation's initial checkpoint.", "",
    "| Country | AI | Idle turns | Accepted actions / year | Import spending | Export receipts | Net trade energy | Rejections |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...Object.entries(analysis.countries).map(([id, value]) => `| ${id} | ${value.mode ?? "unknown"} | ${(100 * value.idleFraction).toFixed(1)}% | ${value.actionsPerYear.toFixed(1)} | ${value.importEnergy.toFixed(0)} | ${value.exportEnergy.toFixed(0)} | ${value.netTradeEnergy.toFixed(0)} | ${Object.values(value.rejected).reduce((sum, count) => sum + count, 0)} |`), "",
    "Import spending includes fees; export receipts are net of fees. A positive forecast cashflow can coexist with low cash if the controller does not execute exports. See analysis.json for resource volumes, opportunity assessments, low-stock runway turns, accepted milestones and integration timing.", "",
    "## Development pace", "",
    "Yearly endpoints and the latest partial endpoint are shown below. Changes cover the interval since the previous endpoint. Existing research and development in the initial checkpoint are excluded from gains. Mobile navy health is a rough measure, not combat effectiveness.", "",
    "| Game year | Country | Systems | Colonies | Mobile navy health | Crew | New technologies | Research / month | Import / export energy in interval |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...pace.flatMap((endpoint) => endpoint.factions.filter((faction) => faction.mode === "active").map((faction) => `| ${endpoint.year.toFixed(2)} | ${faction.factionId} | ${faction.systems} | ${faction.colonies} | ${(faction.militaryPower ?? 0).toFixed(0)} | ${faction.crew ?? 0} | ${faction.newTechnologies} | ${(faction.researchIncome ?? 0).toFixed(1)} | ${faction.importSpending.toFixed(0)} / ${faction.exportReceipts.toFixed(0)} |`)), "",
    "Queue removal does not distinguish completion from cancellation; ship removal does not automatically mean a combat loss. Events and full checkpoints retain the underlying evidence. Integration runtime excludes report generation and most between-tick host suspension; it is elapsed time, not CPU time.", ""];
  writeFileSync(path.join(directory, "analysis.md"), report.join("\n"));
  return analysis;
}
