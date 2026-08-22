/**
 * Universal upstream auto-retry with a waiting stream.
 *
 * When every planned upstream attempt fails with a transient failure (rate
 * limit, server error, retryable status, or network error), the gateway must
 * not bubble that failure to the client. Streaming requests are held open with
 * periodic SSE keep-alive frames so the client never times out; non-streaming
 * JSON requests stay pending for at most WAITING_RETRY_MAX_NON_STREAMING_WAIT_MS
 * and then receive a 503 with a clear body. Upstream attempts retry after
 * WAITING_RETRY_COOLDOWN_MS (extended to a longer Retry-After header when one
 * arrives) without a retry-count limit until an attempt succeeds or the client
 * disconnects.
 */
import type { GatewayProviderProtocol } from "@ccr/core/contracts/app";
import { clampNumber } from "@ccr/core/gateway/internal/collections";
import { parseJsonObjectSafe } from "@ccr/core/gateway/http/body";

/** Fixed cooldown between upstream attempts once the plan has failed. */
export const WAITING_RETRY_COOLDOWN_MS = 15_000;
/** Cadence of SSE keep-alive frames emitted while holding a streaming request open. */
export const WAITING_RETRY_KEEP_ALIVE_INTERVAL_MS = 10_000;
/** Total wait budget for non-streaming JSON requests before returning 503. */
export const WAITING_RETRY_MAX_NON_STREAMING_WAIT_MS = 600_000;
// A single cooldown never exceeds this even when upstream asks for more, so a
// broken or hostile Retry-After value cannot park a request slot for days.
export const WAITING_RETRY_MAX_SINGLE_WAIT_MS = 600_000;

export type WaitingRetryOptions = {
  cooldownMs?: number;
  keepAliveIntervalMs?: number;
  maxNonStreamingWaitMs?: number;
};

export type ResolvedWaitingRetryOptions = {
  cooldownMs: number;
  keepAliveIntervalMs: number;
  maxNonStreamingWaitMs: number;
};

export function resolveWaitingRetryOptions(options?: WaitingRetryOptions): ResolvedWaitingRetryOptions {
  return {
    cooldownMs: clampNumber(options?.cooldownMs ?? WAITING_RETRY_COOLDOWN_MS, 0, WAITING_RETRY_MAX_SINGLE_WAIT_MS),
    keepAliveIntervalMs: clampNumber(options?.keepAliveIntervalMs ?? WAITING_RETRY_KEEP_ALIVE_INTERVAL_MS, 1, 60_000),
    maxNonStreamingWaitMs: clampNumber(
      options?.maxNonStreamingWaitMs ?? WAITING_RETRY_MAX_NON_STREAMING_WAIT_MS,
      0,
      Number.MAX_SAFE_INTEGER
    )
  };
}

/** Parses a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfterHeaderMs(value: string | null | undefined, nowMs: number = Date.now()): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(trimmed);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : undefined;
}

/**
 * Cooldown before the next upstream attempt: the fixed cooldown, extended to a
 * LONGER Retry-After when upstream sends one. A shorter Retry-After never
 * shortens the fixed cooldown.
 */
export function waitingCooldownMs(input: { cooldownMs: number; retryAfterHeader?: string | null }): number {
  const retryAfterMs = parseRetryAfterHeaderMs(input.retryAfterHeader);
  if (retryAfterMs === undefined || retryAfterMs <= input.cooldownMs) {
    return input.cooldownMs;
  }
  return Math.min(retryAfterMs, WAITING_RETRY_MAX_SINGLE_WAIT_MS);
}

/** A request expects a streamed response when its JSON body asks for stream:true. */
export function isStreamingRequestBody(body: Buffer | undefined): boolean {
  return parseJsonObjectSafe(body)?.stream === true;
}

const anthropicWaitingKeepAliveChunk = 'event: ping\ndata: {"type":"ping"}\n\n';

/**
 * Keep-alive frame for the held-open waiting stream. Anthropic clients receive
 * the protocol's own ping event; every other SSE consumer receives a comment
 * line, which all EventSource parsers (including this repo's SSE error
 * detector) ignore.
 */
export function waitingKeepAliveChunk(protocol: GatewayProviderProtocol | undefined): string {
  return protocol === "anthropic_messages" ? anthropicWaitingKeepAliveChunk : ": keep-alive\n\n";
}

export function waitingStreamContentType(): string {
  return "text/event-stream; charset=utf-8";
}

/**
 * Terminal SSE frame for a failure that can no longer change the response
 * status because the held-open stream already committed the client to a 200
 * text/event-stream response. Uses this repo's own SSE error shape (an
 * `event: error` frame carrying a JSON data payload) so createSseErrorDetector
 * and every EventSource client recognize it. A JSON upstream body is forwarded
 * verbatim so the client still sees the provider's real error object.
 */
export function waitingStreamErrorChunk(input: {
  message: string;
  protocol?: GatewayProviderProtocol;
  upstreamBodyText?: string;
}): string {
  const payload = parseJsonObjectPayload(input.upstreamBodyText) ?? (
    input.protocol === "anthropic_messages"
      ? { error: { message: input.message, type: "api_error" }, type: "error" }
      : { error: { code: "upstream_unavailable", message: input.message } }
  );
  return `event: error\ndata: ${JSON.stringify(payload)}\n\n`;
}

function parseJsonObjectPayload(text: string | undefined): Record<string, unknown> | undefined {
  const trimmed = text?.trim();
  if (!trimmed || trimmed.length > 1_048_576) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Holds a streaming client connection open while upstream retries run in the
 * background: emits keep-alive frames on an interval, adopts the eventual
 * successful upstream body into the same stream, and cleans up its timer and
 * abort listener as soon as the client disconnects.
 */
export type WaitingResponseStream = {
  /** The synthesized 200 text/event-stream response the client receives. */
  readonly response: Response;
  /** Pumps a successful upstream response body into the held-open stream. */
  adopt(upstreamResponse: Response): Promise<void>;
  /** Writes one terminal SSE error frame and closes the held-open stream. */
  failWith(errorChunk: string): void;
  /** Stops keep-alives, detaches the abort listener, and closes the stream. */
  dispose(): void;
};

export function startWaitingResponseStream(input: {
  intervalMs: number;
  keepAliveChunk: () => string;
  signal?: AbortSignal;
}): WaitingResponseStream {
  const encoder = new TextEncoder();
  let abortListener: (() => void) | undefined;
  let boundSignal: AbortSignal | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let disposed = false;
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  const enqueue = (chunk: Uint8Array): void => {
    if (disposed || !controller) {
      return;
    }
    try {
      controller.enqueue(chunk);
    } catch {
      // Controller already closed or errored; stop feeding the stream.
      stopKeepAlive();
    }
  };
  const stopKeepAlive = (): void => {
    if (keepAliveTimer !== undefined) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
    }
  };
  const detachSignal = (): void => {
    if (boundSignal && abortListener) {
      boundSignal.removeEventListener("abort", abortListener);
    }
    boundSignal = undefined;
    abortListener = undefined;
  };
  const closeController = (): void => {
    stopKeepAlive();
    const current = controller;
    controller = undefined;
    if (!current) {
      return;
    }
    try {
      current.close();
    } catch {
      // Already closed or errored; nothing left to do.
    }
  };
  const failController = (error: Error): void => {
    stopKeepAlive();
    const current = controller;
    controller = undefined;
    try {
      current?.error(error);
    } catch {
      // Already closed or errored; nothing left to do.
    }
  };
  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    stopKeepAlive();
    detachSignal();
    closeController();
  };

  const stream = new ReadableStream<Uint8Array>({
    start: (streamController) => {
      controller = streamController;
      // Flush headers immediately so intermediaries see the response and
      // clients stop waiting for the first byte.
      enqueue(encoder.encode(input.keepAliveChunk()));
    },
    cancel: () => {
      // The client went away without the shared abort signal noticing.
      stopKeepAlive();
    }
  });
  if (input.signal) {
    abortListener = () => dispose();
    input.signal.addEventListener("abort", abortListener, { once: true });
    boundSignal = input.signal;
  }
  keepAliveTimer = setInterval(() => {
    enqueue(encoder.encode(input.keepAliveChunk()));
  }, input.intervalMs);
  keepAliveTimer.unref?.();

  const response = new Response(stream, {
    headers: {
      "cache-control": "no-store",
      "content-type": waitingStreamContentType()
    },
    status: 200
  });

  return {
    response,
    async adopt(upstreamResponse: Response): Promise<void> {
      stopKeepAlive();
      copyAdoptedUpstreamHeaders(response.headers, upstreamResponse.headers);
      const body = upstreamResponse.body;
      if (!body) {
        closeController();
        return;
      }
      if (disposed || boundSignal?.aborted) {
        // The client went away before adoption started; stop the upstream
        // transfer instead of pumping into a closed stream.
        await cancelUpstreamBody(body);
        return;
      }
      const reader = body.getReader();
      // A disconnected client must also stop the upstream read: cancelling the
      // reader settles any pending read immediately instead of leaving it pending.
      const cancelUpstreamOnAbort = (): void => {
        void reader.cancel().catch(() => {
          // The upstream body may already be closed; nothing left to cancel.
        });
      };
      boundSignal?.addEventListener("abort", cancelUpstreamOnAbort, { once: true });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || disposed) break;
          enqueue(value);
        }
        closeController();
      } catch (error) {
        // Surface upstream mid-body failures to the client through the same
        // stream error path a direct pipe would have used.
        failController(error instanceof Error ? error : new Error(String(error)));
      } finally {
        boundSignal?.removeEventListener("abort", cancelUpstreamOnAbort);
      }
    },
    failWith(errorChunk: string): void {
      stopKeepAlive();
      enqueue(encoder.encode(errorChunk));
      closeController();
    },
    dispose
  };
}

async function cancelUpstreamBody(body: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await body.cancel();
  } catch {
    // Best-effort upstream cleanup must not mask the client disconnect.
  }
}

/**
 * Hop-by-hop, framing, and client-identity headers that are never copied from
 * an adopted upstream response onto the held-open stream: framing belongs to
 * the synthesized SSE response (whose body now also carries keep-alive frames,
 * so content-length would be wrong), and set-cookie must not leak one upstream
 * credential's cookies to every client of this gateway response.
 */
const adoptedUpstreamHeaderDenyList = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "content-type",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

function copyAdoptedUpstreamHeaders(target: Headers, upstreamHeaders: Headers): void {
  for (const [name, value] of upstreamHeaders) {
    if (!adoptedUpstreamHeaderDenyList.has(name.toLowerCase())) {
      try {
        target.set(name, value);
      } catch {
        // A forbidden response-header name slipped through on an exotic
        // runtime; skip it rather than failing an otherwise good adoption.
      }
    }
  }
}

/** Terminal 503 returned to a non-streaming client once the wait budget ends. */
export function upstreamWaitingTimeoutResponse(input: {
  attempts: number;
  elapsedMs: number;
  protocol: GatewayProviderProtocol | undefined;
}): Response {
  const waitedSeconds = Math.round(Math.max(0, input.elapsedMs) / 1000);
  const message =
    `Upstream provider remained unavailable after ${Math.max(1, input.attempts)} attempt(s) and ${waitedSeconds}s of waiting.` +
    " This gateway held the non-streaming request open and retried in the background before giving up;" +
    " retry the request or check the upstream provider status.";
  const body = input.protocol === "anthropic_messages"
    ? { error: { message, type: "overloaded_error" }, type: "error" }
    : { error: { code: "upstream_unavailable", message } };
  return new Response(`${JSON.stringify(body)}\n`, {
    headers: { "content-type": "application/json" },
    status: 503
  });
}

/** One log line per queued upstream retry: attempt number, reason, next retry. */
export function logUpstreamRetryAttempt(input: {
  attemptNumber: number;
  cooldownMs: number;
  model?: string;
  reason: string;
  retryAfterHeaderMs?: number;
}): void {
  const fields = [
    `attempt=${input.attemptNumber}`,
    `reason=${input.reason}`,
    ...(input.model ? [`model=${input.model}`] : []),
    ...(input.retryAfterHeaderMs !== undefined ? [`retry_after_ms=${Math.round(input.retryAfterHeaderMs)}`] : []),
    `next_retry_ms=${Math.round(input.cooldownMs)}`
  ];
  console.warn(`[gateway] Upstream unavailable, holding connection open: ${fields.join(" ")}`);
}

export function logUpstreamRetryEnded(input: {
  attempts: number;
  elapsedMs: number;
  mode: "client-disconnect" | "non-streaming-timeout" | "retry-budget-exhausted";
}): void {
  console.warn(
    `[gateway] Upstream retry loop ended (${input.mode}): attempts=${input.attempts} waited_ms=${Math.max(0, Math.round(input.elapsedMs))}`
  );
}
