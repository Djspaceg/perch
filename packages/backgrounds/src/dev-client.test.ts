/**
 * The page's side of the dev endpoint: the same two calls the desktop bridges have, over `fetch`.
 */

import { describe, expect, it } from 'vitest';
import { DEV_FILE_PREFIX, devBackgroundBridge } from '@perch/backgrounds';

describe('devBackgroundBridge', () => {
  it('asks the endpoint with the reference and the target, and hands back its answer', async () => {
    const asked: string[] = [];
    const bridge = devBackgroundBridge((url) => {
      asked.push(url);
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, url: `${DEV_FILE_PREFIX}thermalright/1920x440/a042.mp4` }),
          {
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });

    expect(
      await bridge.ensureBackground('thermalright:a042', { width: 1920, height: 400 }),
    ).toEqual({
      ok: true,
      url: '/__perch/backgrounds/file/thermalright/1920x440/a042.mp4',
    });
    await bridge.previewBackground('thermalright:a042', { width: 1920, height: 400 });
    expect(asked).toEqual([
      '/__perch/backgrounds/ensure?ref=thermalright%3Aa042&w=1920&h=400',
      '/__perch/backgrounds/preview?ref=thermalright%3Aa042&w=1920&h=400',
    ]);
  });

  it('says there is no endpoint when the server answers with a page instead', async () => {
    const bridge = devBackgroundBridge(() =>
      Promise.resolve(
        new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
      ),
    );

    expect(
      await bridge.ensureBackground('thermalright:a042', { width: 1920, height: 400 }),
    ).toEqual({
      ok: false,
      code: 'unreachable',
      reason:
        'this server has no background endpoint (a static build, or the endpoint is not built)',
    });
  });

  it('says so when the server cannot be reached', async () => {
    const bridge = devBackgroundBridge(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(
      await bridge.previewBackground('thermalright:a042', { width: 1920, height: 400 }),
    ).toEqual({
      ok: false,
      code: 'unreachable',
      reason: 'Failed to fetch',
    });
  });
});
