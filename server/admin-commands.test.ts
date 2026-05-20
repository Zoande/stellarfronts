import { strict as assert } from "node:assert";
import test from "node:test";
import {
  ADMIN_COMMAND_DEFINITIONS,
  getAdminCommandDefinition,
  parseAdminCommand,
  tokenizeAdminCommand,
} from "../src/game/AdminCommands";

test("admin command tokenizer preserves quoted arguments", () => {
  assert.deepEqual(
    tokenizeAdminCommand('create_design me corvette name="Test Fleet" weapons=laser,missile defenses=armor utility=null'),
    ["create_design", "me", "corvette", "name=Test Fleet", "weapons=laser,missile", "defenses=armor", "utility=null"],
  );
});

test("admin command parser separates positional args, options, and flags", () => {
  const parsed = parseAdminCommand("advance_days 10 --confirm");
  assert.ok(parsed);
  assert.equal(parsed.canonicalName, "advance_days");
  assert.deepEqual(parsed.args, ["10"]);
  assert.equal(parsed.flags.has("confirm"), true);
  assert.equal(parsed.options.confirm, true);
});

test("admin command parser supports key value options", () => {
  const parsed = parseAdminCommand("start_duel current me 1 countA=5 countB=8 distance=42");
  assert.ok(parsed);
  assert.equal(parsed.canonicalName, "start_duel");
  assert.deepEqual(parsed.args, ["current", "me", "1"]);
  assert.equal(parsed.options.countA, "5");
  assert.equal(parsed.options.countB, "8");
  assert.equal(parsed.options.distance, "42");
});

test("admin command registry exposes planned command categories", () => {
  const names = new Set(ADMIN_COMMAND_DEFINITIONS.map((definition) => definition.name));
  for (const expected of [
    "tick_size",
    "tick_speed",
    "create_ship",
    "damage_fleet",
    "set_fleet_doctrine",
    "start_duel",
    "create_starbase",
    "add_resource",
    "tech_status",
    "set_active_tech",
    "complete_tech",
  ]) {
    assert.equal(names.has(expected), true, `${expected} should be registered`);
  }
});

test("admin command registry resolves aliases and destructive metadata", () => {
  assert.equal(getAdminCommandDefinition("?")?.name, "help");
  assert.equal(getAdminCommandDefinition("reset_galaxy")?.destructive, true);
  assert.equal(getAdminCommandDefinition("goto")?.localOnly, true);
});
