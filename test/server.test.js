import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createChatServer, MemoryStore } from "../server.js";

let server;
let baseUrl;

before(async () => {
  server = createChatServer({ store: new MemoryStore(), pollMs: 25, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test("health endpoint responds", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, "basic-live-chat");
  assert.equal(data.marker, "origin-v2");
  assert.ok(data.requestId);
});

test("hosted chat page is served for same-origin use", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  const page = await response.text();
  assert.match(page, /<title>Basic Live Chat<\/title>/);
  assert.match(page, /location\.origin/);
});

test("messages can be posted and listed", async () => {
  const created = await fetch(`${baseUrl}/api/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: "lobby", displayName: "Tester", body: "Hello", clientId: "test-client" }),
  });
  assert.equal(created.status, 201);
  const message = (await created.json()).message;
  assert.equal(message.body, "Hello");

  const listed = await fetch(`${baseUrl}/api/messages?room=lobby`);
  assert.equal(listed.status, 200);
  const data = await listed.json();
  assert.equal(data.messages.length, 1);
  assert.equal(data.messages[0].display_name, "Tester");
});

test("invalid rooms and empty messages are rejected", async () => {
  const invalidRoom = await fetch(`${baseUrl}/api/messages?room=bad%20room`);
  assert.equal(invalidRoom.status, 400);

  const empty = await fetch(`${baseUrl}/api/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: "lobby", displayName: "Tester", body: "" }),
  });
  assert.equal(empty.status, 400);
});

test("diagnostic endpoints prove origin and echo both POST formats", async () => {
  const ping = await fetch(`${baseUrl}/api/diagnostics/ping?token=test-token`, {
    headers: { origin: "null" },
  });
  assert.equal(ping.status, 200);
  assert.equal(ping.headers.get("x-chat-origin"), "basic-live-chat-api");
  assert.ok(ping.headers.get("x-chat-request-id"));
  const pingData = await ping.json();
  assert.equal(pingData.marker, "basic-live-chat-origin-v2");
  assert.equal(pingData.token, "test-token");
  assert.equal(pingData.received.origin, "null");

  for (const [contentType, body] of [
    ["application/json", JSON.stringify({ token: "json-token" })],
    ["text/plain;charset=UTF-8", "text-token"],
  ]) {
    const response = await fetch(`${baseUrl}/api/diagnostics/echo`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.match(data.token, /^(json|text)-token$/);
  }
});

test("CORS preflight and passive pixel diagnostics work", async () => {
  const preflight = await fetch(`${baseUrl}/api/diagnostics/echo`, {
    method: "OPTIONS",
    headers: {
      origin: "null",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-expose-headers"), /x-chat-origin/);

  const pixel = await fetch(`${baseUrl}/api/diagnostics/pixel.gif`);
  assert.equal(pixel.status, 200);
  assert.equal(pixel.headers.get("content-type"), "image/gif");
  assert.ok((await pixel.arrayBuffer()).byteLength > 20);
});
