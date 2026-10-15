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
  assert.deepEqual(await response.json(), { ok: true, service: "basic-live-chat" });
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
