import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import type { RawData, WebSocketServer } from "ws";

export interface GatewayTarget {
  port: number;
  available: boolean;
  reason?: string;
}

export interface GatewayMetrics {
  activeConnections: number;
  connectingConnections: number;
  rejectedConnections: number;
  upstreamRetries: number;
  queuedBytes: number;
}

export interface GatewayOptions {
  resolveTarget: (gameId: string) => GatewayTarget | null;
  maxAttempts?: number;
  retryMs?: number;
  maxPendingMessages?: number;
  maxPendingBytes?: number;
  maxBufferedBytes?: number;
}

interface PendingMessage {
  data: RawData;
  isBinary: boolean;
  bytes: number;
}

function rawDataBytes(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((sum, item) => sum + item.byteLength, 0);
  return data.byteLength;
}

export function attachGatewayProxy(
  gateway: WebSocketServer,
  options: GatewayOptions,
): { metrics: GatewayMetrics } {
  const maxAttempts = options.maxAttempts ?? 15;
  const retryMs = options.retryMs ?? 2_000;
  const maxPendingMessages = options.maxPendingMessages ?? 64;
  const maxPendingBytes = options.maxPendingBytes ?? 1024 * 1024;
  const maxBufferedBytes = options.maxBufferedBytes ?? 4 * 1024 * 1024;
  const metrics: GatewayMetrics = {
    activeConnections: 0,
    connectingConnections: 0,
    rejectedConnections: 0,
    upstreamRetries: 0,
    queuedBytes: 0,
  };

  gateway.on("connection", (client: WebSocket, request: IncomingMessage) => {
    const requestUrl = new URL(request.url ?? "/", "ws://localhost");
    const gameId = requestUrl.searchParams.get("gameId") ?? "";
    const initialTarget = options.resolveTarget(gameId);
    if (!initialTarget?.available) {
      metrics.rejectedConnections += 1;
      client.close(1013, initialTarget?.reason ?? "Game not available.");
      return;
    }

    const pending: PendingMessage[] = [];
    let pendingBytes = 0;
    let clientClosed = false;
    let connected = false;
    let retryTimer: NodeJS.Timeout | null = null;
    let upstream: WebSocket | null = null;
    let attemptSerial = 0;
    metrics.connectingConnections += 1;

    function clearPending(): void {
      metrics.queuedBytes -= pendingBytes;
      pending.length = 0;
      pendingBytes = 0;
    }

    function tearDown(): boolean {
      if (clientClosed) return false;
      clientClosed = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearPending();
      upstream?.close();
      if (connected) metrics.activeConnections = Math.max(0, metrics.activeConnections - 1);
      else metrics.connectingConnections = Math.max(0, metrics.connectingConnections - 1);
      connected = false;
      return true;
    }

    function closeClient(code: number, reason: string): void {
      if (!tearDown()) return;
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(code, reason.slice(0, 123));
      }
    }

    function safeSend(target: WebSocket, data: RawData, isBinary: boolean): boolean {
      if (target.readyState !== WebSocket.OPEN || target.bufferedAmount > maxBufferedBytes) return false;
      target.send(data, { binary: isBinary });
      return true;
    }

    client.on("message", (data: RawData, isBinary: boolean) => {
      if (connected && upstream && safeSend(upstream, data, isBinary)) return;
      const bytes = rawDataBytes(data);
      if (pending.length >= maxPendingMessages || pendingBytes + bytes > maxPendingBytes) {
        metrics.rejectedConnections += 1;
        closeClient(1009, "Gateway startup queue exceeded.");
        return;
      }
      pending.push({ data, isBinary, bytes });
      pendingBytes += bytes;
      metrics.queuedBytes += bytes;
    });
    client.on("close", () => {
      tearDown();
    });
    client.on("error", () => closeClient(1011, "Client connection failed."));

    function scheduleRetry(attempt: number): void {
      if (clientClosed) return;
      if (attempt >= maxAttempts) {
        metrics.rejectedConnections += 1;
        closeClient(1013, "Game server did not become ready.");
        return;
      }
      metrics.upstreamRetries += 1;
      retryTimer = setTimeout(() => connect(attempt + 1), retryMs);
    }

    function connect(attempt: number): void {
      if (clientClosed) return;
      const target = options.resolveTarget(gameId);
      if (!target?.available) {
        metrics.rejectedConnections += 1;
        closeClient(1013, target?.reason ?? "Game is no longer available.");
        return;
      }

      const serial = ++attemptSerial;
      const candidate = new WebSocket(`ws://127.0.0.1:${target.port}${request.url ?? "/"}`, {
        headers: {
          cookie: request.headers.cookie ?? "",
          origin: request.headers.origin ?? "",
        },
        handshakeTimeout: Math.max(1_000, retryMs),
        maxPayload: maxPendingBytes,
      });
      upstream = candidate;
      let opened = false;

      candidate.on("open", () => {
        if (clientClosed || serial !== attemptSerial) {
          candidate.close();
          return;
        }
        opened = true;
        connected = true;
        metrics.connectingConnections = Math.max(0, metrics.connectingConnections - 1);
        metrics.activeConnections += 1;
        for (const message of pending) {
          if (!safeSend(candidate, message.data, message.isBinary)) {
            closeClient(1013, "Game server is congested.");
            return;
          }
        }
        clearPending();
      });
      candidate.on("message", (data: RawData, isBinary: boolean) => {
        if (!safeSend(client, data, isBinary)) closeClient(1013, "Client connection is congested.");
      });
      candidate.on("error", () => {
        // `ws` emits close after error. The close handler owns retries so an
        // error and close cannot schedule two attempts.
      });
      candidate.on("close", () => {
        if (clientClosed || serial !== attemptSerial) return;
        if (!opened) {
          scheduleRetry(attempt);
          return;
        }
        closeClient(1012, "Game server restarted.");
      });
    }

    connect(1);
  });

  return { metrics };
}
