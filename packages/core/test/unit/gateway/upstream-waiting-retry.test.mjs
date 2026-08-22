import assert from "node:assert/strict";
import test from "node:test";
import { fetchUpstreamWithFallback, maxRetainedFailedAttempts, mergeFallbackResponseHeaders } from "@ccr/core/gateway/upstream/executor.ts";
import {
  WAITING_RETRY_COOLDOWN_MS,
  parseRetryAfterHeaderMs,
  startWaitingResponseStream,
  waitingCooldownMs,
  waitingKeepAliveChunk
} from "@ccr/core/gateway/upstream/waiting-retry.ts";

const offConfig = {
  Providers: [],
  Router: { fallback: { mode: "off", models: [], retryCount: 0 }, rules: [] },
  virtualModelProfiles: []
};
const offFallback = { mode: "off", models: [], retryCount: 0 };

function withStubbedFetch(stub) {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const timings = [];
  globalThis.fetch = async (...args) => {
    fetchCount += 1;
    timings.push(Date.now());
    return await stub(fetchCount, ...args);
  };
  return {
    get count() {
      return fetchCount;
    },
    timings,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

function baseInput(overrides = {}) {
  return {
    body: Buffer.from(JSON.stringify({ messages: [], model: "test-model" })),
    config: offConfig,
    coreAuthToken: "core-token",
    fallback: offFallback,
    headers: {},
    method: "POST",
    path: "/v1/messages",
    routedModel: "test-model",
    upstreamUrl: "http://127.0.0.1:3456/v1/messages",
    ...overrides
  };
}

async function readWholeBody(response) {
  const reader = response.body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

test("fixed cooldown defaults to fifteen seconds and honors only longer Retry-After values", () => {
  assert.equal(WAITING_RETRY_COOLDOWN_MS, 15_000);
  assert.equal(waitingCooldownMs({ cooldownMs: 15_000 }), 15_000);
  // A shorter Retry-After never shortens the fixed cooldown.
  assert.equal(waitingCooldownMs({ cooldownMs: 15_000, retryAfterHeader: "5" }), 15_000);
  // A longer Retry-After is honored.
  assert.equal(waitingCooldownMs({ cooldownMs: 15_000, retryAfterHeader: "30" }), 30_000);
  // HTTP-date form resolves against the supplied clock.
  const now = Date.parse("2026-01-01T00:00:10Z");
  assert.equal(parseRetryAfterHeaderMs("Wed, 01 Jan 2026 00:00:35 GMT", now), 25_000);
  assert.equal(parseRetryAfterHeaderMs("Wed, 01 Jan 2020 00:00:00 GMT", now), 0);
  assert.equal(waitingCooldownMs({ cooldownMs: 15_000, retryAfterHeader: "not-a-date" }), 15_000);
});

test("429 with a longer Retry-After extends the cooldown before the next attempt", async () => {
  const stub = withStubbedFetch((count) => count === 1
    ? new Response(null, {
        headers: { "content-type": "application/json", "retry-after": "0.09" },
        status: 429
      })
    : new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
        status: 200
      }));
  try {
    const result = await fetchUpstreamWithFallback(baseInput({
      waitingRetry: { cooldownMs: 20 }
    }));
    assert.equal(result.response.status, 200);
    assert.equal(stub.count, 2);
    assert.ok(stub.timings[1] - stub.timings[0] >= 80, `second fetch waited ${stub.timings[1] - stub.timings[0]}ms`);
    assert.equal(result.failedAttempts.length, 1);
    assert.equal(result.failedAttempts[0].statusCode, 429);
    assert.equal(result.failedAttempts[0].delayMs, 90);
  } finally {
    stub.restore();
  }
});

test("500 responses are retried silently until success on the third attempt", async () => {
  const stub = withStubbedFetch((count) => new Response(`{"attempt":${count}}`, {
    headers: { "content-type": "application/json" },
    status: count < 3 ? 500 : 200
  }));
  try {
    const result = await fetchUpstreamWithFallback(baseInput({
      waitingRetry: { cooldownMs: 10 }
    }));
    assert.equal(stub.count, 3);
    assert.equal(result.response.status, 200);
    assert.equal(await result.response.text(), '{"attempt":3}');
    assert.deepEqual(result.failedAttempts.map((attempt) => attempt.statusCode), [500, 500]);
  } finally {
    stub.restore();
  }
});

test("network resets are retried like HTTP failures", async () => {
  const stub = withStubbedFetch(async (count) => {
    if (count < 3) {
      throw new Error("read ECONNRESET: connection reset by peer");
    }
    return new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
      status: 200
    });
  });
  try {
    const result = await fetchUpstreamWithFallback(baseInput({
      waitingRetry: { cooldownMs: 10 }
    }));
    assert.deepEqual(result.failedAttempts.map((attempt) => attempt.error?.includes("ECONNRESET")), [true, true], `fetchCount=${stub.count} statuses=${JSON.stringify(result.failedAttempts.map((a) => a.statusCode))}`);
    assert.equal(stub.count, 3);
    assert.equal(result.response.status, 200);
  } finally {
    stub.restore();
  }
});

test("eventual success streams through the held-open SSE response after keep-alive frames", async () => {
  const stub = withStubbedFetch((count) => count < 3
    ? new Response('{"error":{"type":"overloaded_error"}}', {
        headers: { "content-type": "application/json" },
        status: 429
      })
    : new Response('event: message_start\ndata: {"type":"message_start"}\n\n', {
        headers: { "content-type": "text/event-stream" },
        status: 200
      }));
  try {
    const startedAt = Date.now();
    const result = await fetchUpstreamWithFallback(baseInput({
      body: Buffer.from(JSON.stringify({ messages: [], model: "test-model", stream: true })),
      waitingRetry: { cooldownMs: 40, keepAliveIntervalMs: 10 }
    }));
    const elapsed = Date.now() - startedAt;

    assert.equal(stub.count, 3);
    assert.equal(result.response.status, 200);
    assert.ok(result.response.headers.get("content-type").includes("text/event-stream"));
    const clientBody = await readWholeBody(result.response);
    // /v1/messages resolves to the anthropic protocol, so frames are pings.
    const expectedFrame = waitingKeepAliveChunk("anthropic_messages");
    const keepAliveFrames = clientBody.split(expectedFrame).length - 1;
    assert.ok(elapsed >= 80, `waited only ${elapsed}ms`);
    assert.ok(keepAliveFrames >= 3, `expected several keep-alive frames, saw ${keepAliveFrames} in ${JSON.stringify(clientBody)}`);
    assert.ok(clientBody.endsWith('event: message_start\ndata: {"type":"message_start"}\n\n'));
    // Every keep-alive must precede the adopted upstream body.
    const adoptedBodyStart = clientBody.indexOf("event: message_start");
    assert.ok(adoptedBodyStart > 0);
    assert.ok(clientBody.slice(0, adoptedBodyStart).includes(expectedFrame));
    assert.deepEqual(result.failedAttempts.map((attempt) => attempt.statusCode), [429, 429]);
  } finally {
    stub.restore();
  }
});

test("keep-alive frames are emitted on the configured cadence and stop on abort", async () => {
  const controller = new AbortController();
  const instance = startWaitingResponseStream({
    intervalMs: 10,
    keepAliveChunk: () => ": keep-alive\n\n",
    signal: controller.signal
  });
  const stamps = [];
  const reader = instance.response.body.getReader();
  const collector = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      stamps.push(Date.now());
      assert.equal(Buffer.from(value).toString("utf8"), ": keep-alive\n\n");
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 55));
  const framesBeforeAbort = stamps.length;
  assert.ok(framesBeforeAbort >= 4, `expected >=4 frames in 55ms at 10ms cadence, saw ${framesBeforeAbort}`);
  controller.abort(new Error("client disconnected"));
  await collector;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(stamps.length, framesBeforeAbort, "no frames may be emitted after the client abort");
});

test("anthropic protocol receives its own ping event as the keep-alive frame", () => {
  assert.equal(waitingKeepAliveChunk("anthropic_messages"), 'event: ping\ndata: {"type":"ping"}\n\n');
  assert.equal(waitingKeepAliveChunk("openai_chat_completions"), ": keep-alive\n\n");
  assert.equal(waitingKeepAliveChunk(undefined), ": keep-alive\n\n");
});

test("a client abort during adoption cancels the pending upstream body read", async () => {
  const controller = new AbortController();
  const instance = startWaitingResponseStream({
    intervalMs: 60_000,
    keepAliveChunk: () => ": keep-alive\n\n",
    signal: controller.signal
  });
  let upstreamCancelled = false;
  const encoder = new TextEncoder();
  let emittedFirstChunk = false;
  const upstreamBody = new ReadableStream({
    pull(c) {
      // Emit exactly one chunk and then leave the read genuinely pending, so
      // adoption is blocked mid-transfer when the abort arrives. (A pull that
      // enqueued on every call would spin the pump through microtasks and
      // starve the timer that fires the abort.)
      if (emittedFirstChunk) {
        return;
      }
      emittedFirstChunk = true;
      c.enqueue(encoder.encode('event: message_start\ndata: {"type":"message_start"}\n\n'));
    },
    cancel() {
      upstreamCancelled = true;
    }
  });
  const upstream = new Response(upstreamBody, {
    headers: { "content-type": "text/event-stream" },
    status: 200
  });

  const adoption = instance.adopt(upstream);
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort(new Error("client disconnected"));
  await adoption;

  assert.equal(upstreamCancelled, true, "the upstream body read must be cancelled on client abort");
});

test("client disconnect during the cooldown gives up with no further upstream attempts", async () => {
  const stub = withStubbedFetch(() => new Response(null, { status: 429 }));
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("client disconnected")), 30);
  try {
    await assert.rejects(
      fetchUpstreamWithFallback(baseInput({
        signal: controller.signal,
        waitingRetry: { cooldownMs: 250 }
      })),
      (error) => {
        assert.match(error.message, /client disconnected/);
        assert.equal(error.name, "UpstreamRequestError");
        return true;
      }
    );
    assert.equal(stub.count, 1);
  } finally {
    stub.restore();
  }
});

test("non-streaming JSON requests stop waiting after the max budget and receive a clear 503", async () => {
  const stub = withStubbedFetch(() => new Response('{"error":"down"}', { status: 503 }));
  try {
    const startedAt = Date.now();
    const result = await fetchUpstreamWithFallback(baseInput({
      waitingRetry: { cooldownMs: 15, maxNonStreamingWaitMs: 60 }
    }));
    const elapsed = Date.now() - startedAt;
    assert.equal(result.response.status, 503);
    // The budget is a ceiling on waiting, never a floor.
    assert.ok(elapsed <= 1_000, `waited ${elapsed}ms, far past the 60ms budget`);
    assert.ok(stub.count >= 2, "at least one background retry must happen before giving up");
    const payload = JSON.parse(await result.response.text());
    assert.equal(payload.type, "error");
    assert.equal(payload.error.type, "overloaded_error");
    assert.match(payload.error.message, /retried in the background/);
  } finally {
    stub.restore();
  }
});

test("permanent client-class failures still pass through immediately and unchanged", async () => {
  const stub = withStubbedFetch(() => new Response('{"bad":"request"}', {
    headers: { "content-type": "application/json" },
    status: 400
  }));
  try {
    const result = await fetchUpstreamWithFallback(baseInput({
      waitingRetry: { cooldownMs: 10 }
    }));
    assert.equal(stub.count, 1, "a 400 must never enter the retry loop");
    assert.equal(result.response.status, 400);
    assert.equal(await result.response.text(), '{"bad":"request"}');
    assert.equal(result.failedAttempts.length, 0);
  } finally {
    stub.restore();
  }
});

test("a client-class failure after the stream is open surfaces as an SSE error event, not an adopted body", async () => {
  const stub = withStubbedFetch((count) => count === 1
    ? new Response('{"error":{"type":"overloaded_error"}}', {
        headers: { "content-type": "application/json" },
        status: 429
      })
    : new Response('{"error":{"type":"invalid_request_error","message":"model not allowed"}}', {
        headers: { "content-type": "application/json" },
        status: 400
      }));
  try {
    const result = await fetchUpstreamWithFallback(baseInput({
      body: Buffer.from(JSON.stringify({ messages: [], model: "test-model", stream: true })),
      waitingRetry: { cooldownMs: 10 }
    }));
    assert.equal(stub.count, 2, "the 400 must end the loop instead of being adopted as a success");
    assert.equal(result.response.status, 200, "the held-open stream already committed to a 200 SSE response");
    assert.ok(result.response.headers.get("content-type").includes("text/event-stream"));
    const clientBody = await readWholeBody(result.response);
    assert.ok(clientBody.includes("event: error"), `expected an SSE error frame in ${JSON.stringify(clientBody)}`);
    // The provider's real error object reaches the client verbatim.
    assert.ok(clientBody.includes('"invalid_request_error"'), JSON.stringify(clientBody));
    assert.ok(clientBody.includes('"model not allowed"'), JSON.stringify(clientBody));
    // The stream must be terminated after the error frame, and the 400 is a
    // terminal outcome, not a recorded retry failure.
    assert.deepEqual(result.failedAttempts.map((attempt) => attempt.statusCode), [429]);
  } finally {
    stub.restore();
  }
});

test("retry mode honors the configured retryCount instead of retrying forever", async () => {
  const stub = withStubbedFetch(() => new Response('{"error":"down"}', { status: 500 }));
  try {
    const result = await fetchUpstreamWithFallback(baseInput({
      fallback: { mode: "retry", models: [], retryCount: 0 },
      waitingRetry: { cooldownMs: 10, maxNonStreamingWaitMs: 60_000 }
    }));
    // retryCount 0 plans exactly one attempt; the waiting loop must stop there
    // instead of re-running the plan until the (generous) wait budget ends.
    assert.equal(stub.count, 1, `expected the retry budget to end the loop, saw ${stub.count} fetches`);
    assert.equal(result.response.status, 503);
    const payload = JSON.parse(await result.response.text());
    assert.match(payload.error.message, /attempt\(s\)/);
  } finally {
    stub.restore();
  }
});

test("an exhausted streaming retry budget reports an SSE error on the held-open stream", async () => {
  const stub = withStubbedFetch(() => new Response('{"error":"down"}', { status: 429 }));
  try {
    const result = await fetchUpstreamWithFallback(baseInput({
      body: Buffer.from(JSON.stringify({ messages: [], model: "test-model", stream: true })),
      fallback: { mode: "retry", models: [], retryCount: 0 },
      waitingRetry: { cooldownMs: 5, maxNonStreamingWaitMs: 60_000 }
    }));
    assert.equal(stub.count, 1);
    assert.equal(result.response.status, 200);
    const clientBody = await readWholeBody(result.response);
    assert.ok(clientBody.includes("event: error"), JSON.stringify(clientBody));
    assert.ok(clientBody.includes("retry budget is exhausted"), JSON.stringify(clientBody));
  } finally {
    stub.restore();
  }
});

test("failure diagnostics stay bounded while reported attempt counts stay exact", async () => {
  const controller = new AbortController();
  const stub = withStubbedFetch((count) => {
    if (count > maxRetainedFailedAttempts + 50) {
      controller.abort(new Error("client disconnected"));
    }
    return new Response(null, { status: 500 });
  });
  try {
    await assert.rejects(
      fetchUpstreamWithFallback(baseInput({
        body: Buffer.from(JSON.stringify({ messages: [], model: "test-model", stream: true })),
        signal: controller.signal,
        waitingRetry: { cooldownMs: 0 }
      })),
      (error) => {
        assert.equal(error.name, "UpstreamRequestError");
        // The retained array is a bounded window, not the whole history.
        assert.equal(error.failedAttempts.length, maxRetainedFailedAttempts);
        return true;
      }
    );
    assert.ok(
      stub.count > maxRetainedFailedAttempts,
      `expected more than ${maxRetainedFailedAttempts} attempts, saw ${stub.count}`
    );
  } finally {
    stub.restore();
  }
});

test("x-ccr-fallback-attempts reports the exact total even when diagnostics were trimmed", async () => {
  const stub = withStubbedFetch(() => new Response('{"error":"down"}', { status: 500 }));
  try {
    const result = await fetchUpstreamWithFallback(baseInput({
      waitingRetry: { cooldownMs: 0, maxNonStreamingWaitMs: 120 }
    }));
    assert.ok(stub.count >= 2, "at least one background retry must happen before giving up");
    assert.ok(result.failedAttempts.length <= maxRetainedFailedAttempts);
    const headers = mergeFallbackResponseHeaders(new Headers(), result);
    // Every failed round is one upstream attempt; the header counts them all
    // whether or not the retained window trimmed older entries.
    assert.equal(headers.get("x-ccr-fallback-attempts"), String(stub.count + 1));
    if (result.failedAttemptsTotal !== undefined) {
      assert.equal(result.failedAttemptsTotal, stub.count);
      assert.ok(headers.get("x-ccr-fallback-failures").startsWith("..."), "trimmed entries are elided, not dropped silently");
    } else {
      assert.equal(result.failedAttempts.length, stub.count);
    }
  } finally {
    stub.restore();
  }
});
