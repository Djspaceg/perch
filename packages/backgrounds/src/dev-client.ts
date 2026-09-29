/**
 * A page's background calls under `npm run dev`: the desktop bridges' `ensureBackground` and
 * `previewBackground`, answered by the dev server's endpoint (`dev-endpoint.ts`) instead of a main
 * process. The answers have the bridges' shape, so each page checks them with the code it already
 * has, against `DEV_FILE_PREFIX` rather than `perch-cache://`.
 *
 * Browser-safe: `fetch` only.
 */

/** Where the dev server answers background calls. */
export const DEV_BACKGROUNDS_PREFIX = '/__perch/backgrounds/';

/** Where it serves cache files; a page plays nothing from anywhere else. */
export const DEV_FILE_PREFIX = `${DEV_BACKGROUNDS_PREFIX}file/`;

interface Size {
  readonly width: number;
  readonly height: number;
}

export interface DevBackgroundBridge {
  ensureBackground(ref: string, target: Size): Promise<unknown>;
  previewBackground(ref: string, target: Size): Promise<unknown>;
}

const NO_ENDPOINT =
  'this server has no background endpoint (a static build, or the endpoint is not built)';

export function devBackgroundBridge(
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url),
): DevBackgroundBridge {
  const ask = async (what: 'ensure' | 'preview', ref: string, target: Size): Promise<unknown> => {
    const query = new URLSearchParams({
      ref,
      w: String(target.width),
      h: String(target.height),
    });
    try {
      const response = await fetchFn(`${DEV_BACKGROUNDS_PREFIX}${what}?${query.toString()}`);
      // A server without the endpoint answers its own page for any path it does not know.
      if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
        return { ok: false, code: 'unreachable', reason: NO_ENDPOINT };
      }
      return (await response.json()) as unknown;
    } catch (error) {
      return {
        ok: false,
        code: 'unreachable',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return {
    ensureBackground: (ref, target) => ask('ensure', ref, target),
    previewBackground: (ref, target) => ask('preview', ref, target),
  };
}
