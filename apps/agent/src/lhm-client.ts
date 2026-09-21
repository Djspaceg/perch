/**
 * The one HTTP call the relay makes: `GET /data.json` from LibreHardwareMonitor.
 *
 * Kept behind a one-function interface so that everything above it — the poll loop, the
 * mapping, the publishing — is testable with no network and no fixture server. The real
 * implementation is a `fetch` with a timeout; a test supplies a function that returns the
 * captured payload.
 *
 * ## Failure is a normal outcome, and it has to be legible
 *
 * LHM is a separate process on a possibly-separate machine that a human closes without
 * warning. So every failure path throws an `LhmRequestError` naming the URL and what went
 * wrong, and the poll loop logs it and keeps going: SPEC rule 4 says a dead source must be
 * visible, not fatal. A relay that exited on the first refused connection would take the
 * broker down with it and the dashboard would lose even its stale readings.
 */

import { lhmDataUrl, type LhmEndpoint } from './config.js';

/** Fetches and JSON-decodes one `/data.json` payload. Rejects with `LhmRequestError`. */
export type LhmDataFetcher = () => Promise<unknown>;

/**
 * Anything that went wrong reaching or reading LHM.
 *
 * One error type rather than several, because every caller does the same thing with it — logs
 * it and waits for the next tick — and because the distinction that matters to a human is in
 * the message, not the class. `cause` keeps the underlying `fetch` error for a stack.
 */
export class LhmRequestError extends Error {
  override readonly name = 'LhmRequestError';
  readonly url: string;

  constructor(url: string, detail: string, cause?: unknown) {
    super(`GET ${url} failed: ${detail}`, cause === undefined ? undefined : { cause });
    this.url = url;
  }
}

/**
 * A fetcher for one LHM endpoint.
 *
 * `AbortSignal.timeout` rather than a manual `setTimeout`/`clearTimeout` pair: the timer it
 * creates does not hold the event loop open, so an abandoned request cannot keep the process
 * alive past shutdown. Without a timeout a single half-open TCP connection — a sleeping host
 * on the same LAN, which is exactly the deployment here — would stall the poll loop
 * indefinitely and the relay would go quiet with no error at all.
 */
export function createLhmDataFetcher(
  endpoint: LhmEndpoint,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): LhmDataFetcher {
  const url = lhmDataUrl(endpoint);

  return async (): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
      });
    } catch (cause) {
      throw new LhmRequestError(url, describeFetchFailure(cause, timeoutMs), cause);
    }

    if (!response.ok) {
      throw new LhmRequestError(url, `HTTP ${response.status} ${response.statusText}`);
    }

    // `response.json()` rather than `JSON.parse(await response.text())`: identical result, and
    // it does not materialise a second copy of a 60 KB body once a second.
    try {
      return await response.json();
    } catch (cause) {
      throw new LhmRequestError(url, 'response body is not JSON', cause);
    }
  };
}

/**
 * A readable reason for a `fetch` rejection.
 *
 * `fetch` reports a refused connection, a DNS miss and a timeout all as `TypeError: fetch
 * failed` with the real reason one level down in `cause`, and a timeout as an `AbortError`
 * with no mention of the duration. Both are useless in a log without this unwrapping, and the
 * first thing a human debugging "no readings" needs to know is whether LHM refused the
 * connection or was never reached at all.
 */
function describeFetchFailure(cause: unknown, timeoutMs: number): string {
  if (cause instanceof Error && cause.name === 'TimeoutError') {
    return `no response within ${timeoutMs} ms`;
  }

  if (cause instanceof Error) {
    const inner = cause.cause;
    const detail = inner instanceof Error ? inner.message : undefined;

    return detail === undefined ? cause.message : `${cause.message} (${detail})`;
  }

  return String(cause);
}
