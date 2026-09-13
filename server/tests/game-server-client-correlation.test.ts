import assert from "node:assert/strict";
import test from "node:test";
import { GameServerClient } from "../../src/game/GameServerClient";

type Listener = (event: { data?: string }) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  static instance: FakeWebSocket | null = null;
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  private listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instance = this;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  serverMessage(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  private emit(type: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function snapshot(protocolVersion = 8) {
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

test("protocol 8+ commands resolve out of order without disturbing detail or admin requests", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, {
    WebSocket: FakeWebSocket,
    window: {
      setTimeout,
      clearTimeout,
    },
  });
  try {
    const client = new GameServerClient("game", "ws://example.test");
    const connecting = client.connect();
    const socket = FakeWebSocket.instance;
    assert.ok(socket);
    socket.open();
    socket.serverMessage(snapshot());
    await connecting;

    const first = client.executeCommand({ type: "setSpeedMultiplier", multiplier: 1 });
    const second = client.executeCommand({ type: "setSpeedMultiplier", multiplier: 2 });
    const detail = client.requestDetail("market");
    const admin = client.executeAdminCommand("help");

    const gameplay = socket.sent.filter((command) => command.type === "setSpeedMultiplier");
    const firstId = String(gameplay[0].requestId);
    const secondId = String(gameplay[1].requestId);
    const adminCommand = socket.sent.find((command) => command.type === "adminCommand");

    socket.serverMessage({
      type: "commandResult",
      ok: false,
      message: "Second failed.",
      requestId: secondId,
    });
    socket.serverMessage({
      type: "commandResult",
      ok: true,
      message: "First succeeded.",
      requestId: firstId,
    });

    assert.equal((await second).ok, false);
    assert.equal((await first).ok, true);

    socket.serverMessage({
      type: "detail",
      scope: "market",
      id: null,
      status: "full",
      revision: "market-1",
      payload: {},
    });
    socket.serverMessage({
      type: "adminCommandResult",
      requestId: adminCommand?.requestId,
      ok: true,
      input: "help",
      message: "Done.",
    });
    assert.equal((await detail).status, "full");
    assert.equal((await admin).ok, true);
    client.dispose();
  } finally {
    Object.assign(globalThis, {
      WebSocket: originalWebSocket,
      window: originalWindow,
    });
  }
});

test("protocol 9 send adds the request ID required by authoritative commands", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  Object.assign(globalThis, {
    WebSocket: FakeWebSocket,
    window: {
      setTimeout,
      clearTimeout,
    },
  });
  try {
    const client = new GameServerClient("game", "ws://example.test");
    const connecting = client.connect();
    const socket = FakeWebSocket.instance;
    assert.ok(socket);
    socket.open();
    socket.serverMessage(snapshot(9));
    await connecting;

    client.send({
      type: "buildPlanetBuilding",
      planetId: "planet-1",
      area: "city",
      slotIndex: 0,
      buildingKind: "fortress",
    });

    const command = socket.sent.find((entry) => entry.type === "buildPlanetBuilding");
    assert.equal(typeof command?.requestId, "string");
    assert.ok(String(command?.requestId).length > 0);
    client.dispose();
  } finally {
    Object.assign(globalThis, {
      WebSocket: originalWebSocket,
      window: originalWindow,
    });
  }
});
