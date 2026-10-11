import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createHeadlessGame } from "../game/headless-game";
import { campaignSample } from "../game/active-lab";
import { campaignViewer } from "../game/campaign-viewer";

test("campaign viewer renders every metric and both timeline endpoints with finite canvas coordinates", () => {
  const game = createHeadlessGame({ initialWorld: { starCount: 8, factionCount: 2 }, stepMs: 24000 });
  const state = game.diagnosticState();
  const first = campaignSample(state, [0], 0); game.step();
  const frames = [first, campaignSample(game.diagnosticState(), [0], 1)];
  const html = campaignViewer({ stars: state.stars.map(({ id, x, z, name }) => ({ id, x, z, name })), hyperlanes: state.hyperlanes,
    factions: state.factions.map((faction) => ({ ...faction, mode: faction.id === 0 ? "active" : "passive" })), frames,
    summary: { options: { seed: 42, active: 1, stepMs: 24000 }, actualStars: 8, actualCountries: 2, simulatedDays: 1, runtimeMs: 100,
      accepted: 0, rejected: 0, ownershipChanges: 0, warsStarted: 0 } });
  let draws = 0;
  const context = new Proxy({}, { get: (_target, method) => (...args: unknown[]) => {
    for (const value of args) if (typeof value === "number") assert.ok(Number.isFinite(value), `${String(method)} coordinate: ${value}`);
    draws++;
  } });
  const element = () => ({ value: "0", style: {}, clientWidth: 800, append: (..._args: unknown[]) => {}, replaceChildren: () => {}, getContext: () => context });
  const elements = new Map<string, ReturnType<typeof element>>();
  const getElement = (id: string) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id)!; };
  getElement("metric").value = "systems";
  const sandbox = { document: { getElementById: getElement, createElement: element, createTextNode: (value: unknown) => String(value) },
    window: {}, devicePixelRatio: 1, setInterval: () => 1, clearInterval: () => {} };
  runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)![1], sandbox);
  const metrics = html.match(/<select id="metric">([\s\S]*?)<\/select>/)![1].matchAll(/value="([^"]+)"/g);
  for (const [, metric] of metrics) {
    getElement("metric").value = metric;
    for (const index of [0, 1]) { getElement("frame").value = String(index); runInNewContext("draw()", sandbox); }
  }
  assert.ok(draws > 100);
});
