import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptSnapshot,
  adaptUpdate,
  decodeServerEvent,
  ProtocolValidationError,
  reduceSnapshot,
} from "../../src/game/ProtocolAdapter";

function protocolSnapshot(protocolVersion: number): Record<string, unknown> {
  return {
    type: "snapshot",
    protocolVersion,
    perspective: { mode: "observer" },
    clock: { year: 2200 },
    stars: [],
    planetStates: [],
    factions: [],
    hyperlanes: [],
  };
}

test("protocol adapters normalize v5-v10 snapshots into one canonical model", () => {
  for (const protocol of [5, 6, 7, 8, 9, 10]) {
    const snapshot = adaptSnapshot(protocolSnapshot(protocol));
    assert.equal(snapshot.protocolVersion, protocol);
    assert.deepEqual(snapshot.intelligence, { entities: [], lanes: [] });
    assert.deepEqual(snapshot.tradeAlerts, []);
    assert.deepEqual(snapshot.diplomacy, {
      playerFactionId: null,
      openBorderFactionIds: [],
      warFactionIds: [],
    });
  }
});

test("snapshot validation rejects malformed envelopes and unsupported protocols", () => {
  for (const input of [
    null,
    [],
    { type: "update" },
    { type: "snapshot" },
    protocolSnapshot(4),
    { ...protocolSnapshot(7), perspective: null },
    { ...protocolSnapshot(7), clock: null },
  ]) {
    assert.throws(() => adaptSnapshot(input), ProtocolValidationError);
  }
});

test("updates require a snapshot protocol and cannot change it mid-session", () => {
  const valid = {
    type: "update",
    perspective: { mode: "observer" },
    changed: ["fleets", 4, null],
  };
  assert.throws(() => decodeServerEvent(valid), /before the initial snapshot/);
  assert.deepEqual(adaptUpdate(valid, 7).changed, ["fleets"]);
  assert.throws(() => adaptUpdate({ ...valid, protocolVersion: 6 }, 7), /changed protocol/);
  assert.throws(() => adaptUpdate({ ...valid, type: "snapshot" }, 7), /Expected an update/);
  assert.throws(() => adaptUpdate({ ...valid, perspective: null }, 7), /perspective/);
});

test("simple server events validate the fields the client consumes", () => {
  assert.deepEqual(
    decodeServerEvent({ type: "commandResult", ok: true, message: "Done" }),
    { type: "commandResult", ok: true, message: "Done" },
  );
  assert.throws(() => decodeServerEvent({ type: "mystery" }), /Unknown/);
  assert.throws(() => decodeServerEvent({ type: "commandResult", ok: "yes", message: 1 }), /Malformed/);
  assert.throws(() => decodeServerEvent({ type: "accountResources", darkMatter: "none" }), /Malformed/);
  assert.throws(() => decodeServerEvent({ type: "serverInfo", message: 7 }), /Malformed/);
  assert.deepEqual(
    decodeServerEvent({ type: "commandResult", ok: false, message: "No", requestId: "cmd-1" }),
    { type: "commandResult", ok: false, message: "No", requestId: "cmd-1" },
  );
  assert.throws(
    () => decodeServerEvent({ type: "commandResult", ok: true, message: "Done", requestId: "" }),
    /requestId/,
  );
});

test("snapshot reducer preserves omissions and applies explicit nulls", () => {
  const snapshot = adaptSnapshot(protocolSnapshot(7));
  snapshot.visibleStarIds = [1, 2];
  const reduced = reduceSnapshot(snapshot, adaptUpdate({
    type: "update",
    perspective: { mode: "observer" },
    changed: ["visibility"],
    visibleStarIds: null,
  }, 7));
  assert.equal(reduced.visibleStarIds, null);
  assert.equal(reduced.stars, snapshot.stars);
  assert.equal(reduced.protocolVersion, 7);
  assert.equal(reduced.type, "snapshot");
});
