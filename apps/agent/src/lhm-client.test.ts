/**
 * What a failed `GET /data.json` says about itself.
 *
 * The reason matters beyond the log now: the relay reports it to the editor, whose status label
 * shows it next to "disconnected". So it has to be short and it has to be there — in particular for
 * a refused `localhost`, where Node tries `::1` and `127.0.0.1`, both refuse, and the cause is an
 * `AggregateError` whose own message is empty. That used to log as `fetch failed ()`.
 */

import { describe, expect, it } from 'vitest';
import { LhmRequestError, createLhmDataFetcher } from './lhm-client.js';

const ENDPOINT = { host: 'localhost', port: 28085 };

function systemError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function failureOf(fetchImpl: typeof fetch): Promise<LhmRequestError> {
  try {
    await createLhmDataFetcher(ENDPOINT, 1500, fetchImpl)();
  } catch (error) {
    if (error instanceof LhmRequestError) return error;
    throw error;
  }
  throw new Error('the fetch did not fail');
}

describe('LhmRequestError.reason', () => {
  it('names the code when both addresses of localhost refuse, instead of printing ()', async () => {
    const error = await failureOf(() =>
      Promise.reject(
        new TypeError('fetch failed', {
          cause: new AggregateError(
            [
              systemError('ECONNREFUSED', 'connect ECONNREFUSED ::1:28085'),
              systemError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:28085'),
            ],
            '',
          ),
        }),
      ),
    );

    expect(error.reason).toBe('ECONNREFUSED');
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.message).not.toContain('()');
  });

  it('names the code of a single system error, EHOSTUNREACH being the usual one', async () => {
    const error = await failureOf(() =>
      Promise.reject(
        new TypeError('fetch failed', {
          cause: systemError('EHOSTUNREACH', 'connect EHOSTUNREACH 192.168.1.3:8085'),
        }),
      ),
    );

    expect(error.reason).toBe('EHOSTUNREACH');
    expect(error.message).toContain('connect EHOSTUNREACH 192.168.1.3:8085');
  });

  it('says how long it waited on a timeout', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const error = await failureOf(() => Promise.reject(timeout));

    expect(error.reason).toBe('no response within 1500 ms');
  });

  it('carries the HTTP status when the server answered with an error', async () => {
    const error = await failureOf(() =>
      Promise.resolve(new Response('nope', { status: 404, statusText: 'Not Found' })),
    );

    expect(error.reason).toBe('HTTP 404 Not Found');
  });
});
