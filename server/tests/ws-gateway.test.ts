import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { attachGatewayProxy } from "../ws-gateway";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function listeningServer(): Promise<{ server: WebSocketServer; port: number }> {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, port: address.port };
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => socket.once("close", (code, reason) => {
    resolve({ code, reason: reason.toString() });
  }));
}

async function closeServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) client.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("gateway rejects unavailable games without opening an upstream connection", async () => {
  const gateway = await listeningServer();
  const proxy = attachGatewayProxy(gateway.server, {
    resolveTarget: () => ({ port: 1, available: false, reason: "Game is preparing." }),
  });
  const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/?gameId=cold`);
  try {
    const closed = await waitForClose(client);
    assert.equal(closed.code, 1013);
    assert.equal(closed.reason, "Game is preparing.");
    assert.deepEqual(proxy.metrics, {
      activeConnections: 0,
      connectingConnections: 0,
      rejectedConnections: 1,
      upstreamRetries: 0,
      queuedBytes: 0,
    });
  } finally {
    client.terminate();
    await closeServer(gateway.server);
  }
});

test("gateway preserves queued messages across a cold-start retry", async () => {
  const upstreamPort = await freePort();
  const gateway = await listeningServer();
  const proxy = attachGatewayProxy(gateway.server, {
    resolveTarget: () => ({ port: upstreamPort, available: true }),
    retryMs: 25,
    maxAttempts: 12,
  });
  const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/?gameId=test`);
  let upstream: WebSocketServer | null = null;
  try {
    await new Promise<void>((resolve) => client.once("open", resolve));
    client.send("queued-before-upstream");
    await new Promise((resolve) => setTimeout(resolve, 70));
    upstream = new WebSocketServer({ port: upstreamPort, host: "127.0.0.1" });
    upstream.on("connection", (socket) => socket.on("message", (message) => socket.send(message)));
    const echoed = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("gateway retry timed out")), 2_000);
      client.once("message", (message) => {
        clearTimeout(timer);
        resolve(String(message));
      });
    });
    assert.equal(echoed, "queued-before-upstream");
    assert.equal(proxy.metrics.activeConnections, 1);
    assert.equal(proxy.metrics.connectingConnections, 0);
    assert.equal(proxy.metrics.queuedBytes, 0);
    assert.ok(proxy.metrics.upstreamRetries >= 1);
  } finally {
    if (client.readyState !== WebSocket.CLOSED) {
      const closed = waitForClose(client);
      client.close();
      await closed;
    }
    if (upstream) await closeServer(upstream);
    await closeServer(gateway.server);
  }
  await waitUntil(() => proxy.metrics.activeConnections === 0);
  assert.equal(proxy.metrics.activeConnections, 0);
});

test("gateway forwards large server snapshots independently of the startup queue cap", async () => {
  const upstream = await listeningServer();
  const gateway = await listeningServer();
  const snapshot = Buffer.alloc(2 * 1024 * 1024, "s");
  upstream.server.on("connection", (socket) => socket.send(snapshot));
  attachGatewayProxy(gateway.server, {
    resolveTarget: () => ({ port: upstream.port, available: true }),
    maxPendingBytes: 8,
  });
  const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/?gameId=large`);
  try {
    const received = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("large snapshot timed out")), 2_000);
      client.once("message", (message) => {
        clearTimeout(timer);
        resolve(Buffer.from(message as Buffer));
      });
    });
    assert.equal(received.byteLength, snapshot.byteLength);
    assert.deepEqual(received, snapshot);
  } finally {
    client.terminate();
    await closeServer(gateway.server);
    await closeServer(upstream.server);
  }
});

test("gateway caps queued startup payloads and releases all metrics", async () => {
  const gateway = await listeningServer();
  const proxy = attachGatewayProxy(gateway.server, {
    resolveTarget: () => ({ port: 1, available: true }),
    retryMs: 200,
    maxAttempts: 10,
    maxPendingMessages: 1,
    maxPendingBytes: 4,
  });
  const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/?gameId=queued`);
  try {
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closedPromise = waitForClose(client);
    client.send("1234");
    client.send("5");
    const closed = await closedPromise;
    assert.equal(closed.code, 1009);
    assert.equal(proxy.metrics.rejectedConnections, 1);
    assert.equal(proxy.metrics.activeConnections, 0);
    assert.equal(proxy.metrics.connectingConnections, 0);
    assert.equal(proxy.metrics.queuedBytes, 0);
  } finally {
    client.terminate();
    await closeServer(gateway.server);
  }
});

test("gateway exhausts bounded retries and cleans up pending data", async () => {
  const missingPort = await freePort();
  const gateway = await listeningServer();
  const proxy = attachGatewayProxy(gateway.server, {
    resolveTarget: () => ({ port: missingPort, available: true }),
    retryMs: 10,
    maxAttempts: 2,
  });
  const client = new WebSocket(`ws://127.0.0.1:${gateway.port}/?gameId=missing`);
  try {
    await new Promise<void>((resolve) => client.once("open", resolve));
    const closedPromise = waitForClose(client);
    client.send("pending");
    const closed = await closedPromise;
    assert.equal(closed.code, 1013);
    assert.equal(proxy.metrics.rejectedConnections, 1);
    assert.equal(proxy.metrics.upstreamRetries, 1);
    assert.equal(proxy.metrics.connectingConnections, 0);
    assert.equal(proxy.metrics.queuedBytes, 0);
  } finally {
    client.terminate();
    await closeServer(gateway.server);
  }
});
