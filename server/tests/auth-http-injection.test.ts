import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAuthRequestHandler } from "../auth-server";
import { AuthStore } from "../auth-store";

test("auth HTTP routes use the injected temporary store", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stellarfronts-auth-http-"));
  const store = new AuthStore(path.join(directory, "auth.sqlite"));
  const server = createServer(createAuthRequestHandler(store));
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/signup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({ username: "injected_http_user", password: "test-password" }),
    });
    assert.equal(response.status, 201);
    assert.equal(store.getAccountByUsername("injected_http_user")?.username, "injected_http_user");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
