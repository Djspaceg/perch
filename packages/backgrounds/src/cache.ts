/**
 * The background cache: download a hosted video (or its preview) once, keep it, hand out its URL.
 *
 * Node, with no Electron: the desktop main process and the Vite dev servers both run this, each
 * injecting its own `fetch` (Electron's `net.fetch`, or Node's) and its own way of turning a file in
 * the cache into a URL its page can read. See docs/backgrounds.md for the layout on disk.
 *
 * ## Atomic, bounded, shared
 *
 * - **Atomic.** A body streams into `.<name>.<random>.part` beside its target and is renamed over it
 *   only once it is complete and looks like what it claims to be (the length it declared, an MP4's
 *   `ftyp` box or a PNG's signature). A rename within a folder is atomic, so a reader, another
 *   process, or a crash never sees half a file under the real name. Any failure unlinks the part.
 * - **Bounded.** A size cap per kind, checked against the declared length and again while
 *   streaming; a time limit per server attempt, covering the body as well as the connect.
 * - **Shared.** One download per file at a time, however many callers ask (the in-flight promise is
 *   handed to each), and a fixed number running at once, so a grid of thumbnails scrolling into view
 *   queues rather than opening a connection per cell.
 *
 * Failures are not remembered, except one: both servers answering 404 for a preview PNG, which is
 * the ordinary case (none was found for `a001` at any size tried) and would otherwise cost two
 * requests every time a thumbnail is shown.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LAYOUT_MAX_DIMENSION, backgroundRef, parseBackgroundRef } from '@perch/layout-schema';
import { isCatalogued, pickHostedSize, sizeName, type HostedSize } from './catalogue.js';

/** The part of `fetch` the cache uses, so a test or a host can supply its own. */
export type FetchLike = (
  url: string,
  init: { readonly signal: AbortSignal; readonly headers?: Record<string, string> },
) => Promise<Response>;

/** A server, and where its files for a size live. */
export interface BackgroundServer {
  readonly name: string;
  /** The folder URL for `size`, ending in `/`. */
  readonly folder: (size: HostedSize) => string;
}

/** Thermalright's two, in the order they are tried. */
export const BACKGROUND_SERVERS: readonly BackgroundServer[] = Object.freeze([
  {
    name: 'international',
    folder: (size: HostedSize) =>
      `http://www.czhorde.cc/tr/bj${String(size.width)}${String(size.height)}/`,
  },
  {
    name: 'china',
    folder: (size: HostedSize) =>
      `http://www.czhorde.com/tr/bj${String(size.width)}${String(size.height)}/`,
  },
]);

export interface BackgroundCacheLimits {
  /** Largest video kept. The probed `a001`s are 0.8 to 2.4 MB. */
  readonly maxVideoBytes: number;
  /** Largest preview PNG kept. */
  readonly maxImageBytes: number;
  /** How much of a video a thumbnail keeps when there is no PNG: its header and first frames. */
  readonly headBytes: number;
  /** Per attempt, by server position; the last applies to any server past the list. */
  readonly timeoutsMs: readonly number[];
  /** Downloads running at once. */
  readonly concurrency: number;
}

export const DEFAULT_BACKGROUND_LIMITS: BackgroundCacheLimits = Object.freeze({
  maxVideoBytes: 64 * 1024 * 1024,
  maxImageBytes: 4 * 1024 * 1024,
  headBytes: 384 * 1024,
  timeoutsMs: Object.freeze([30_000, 60_000]),
  concurrency: 4,
});

/** How old a part file must be before a sweep takes it for an abandoned download. */
const STALE_PART_MS = 60 * 60 * 1000;

export interface BackgroundCacheOptions {
  /** The cache folder: `<userData>/backgrounds` on the desktop. */
  readonly root: string;
  readonly fetch: FetchLike;
  /** A cache name, `thermalright/1920x440/a042.mp4`, as the URL the host's page reads it at. */
  readonly urlFor: (relative: string) => string;
  readonly servers?: readonly BackgroundServer[] | undefined;
  readonly limits?: Partial<BackgroundCacheLimits> | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

/** Why a background could not be had. */
export type BackgroundFailureCode =
  /** The reference, the id or the target is not one this cache serves. No request was made. */
  | 'invalid'
  /** Every server answered 404. */
  | 'not-found'
  /** No server answered usefully: offline, timed out, a server error, a short body. */
  | 'unreachable'
  /** A server sent something that is not the file: an HTML page with a 200. */
  | 'bad-content'
  /** A server sent, or declared, more than the cap. */
  | 'too-large';

export interface BackgroundFailure {
  readonly ok: false;
  readonly code: BackgroundFailureCode;
  /** One line a person can act on, naming each server's answer. */
  readonly reason: string;
}

export type EnsureResult =
  | {
      readonly ok: true;
      readonly url: string;
      readonly path: string;
      readonly size: HostedSize;
      /** `cache`, or the server it was downloaded from. */
      readonly from: string;
    }
  | BackgroundFailure;

export type PreviewResult =
  { readonly ok: true; readonly kind: 'image' | 'video'; readonly url: string } | BackgroundFailure;

export interface BackgroundCache {
  readonly root: string;
  /** The video for `ref` at the size `target` picks, downloaded if it is not cached. */
  ensure(ref: string, target: TargetSize): Promise<EnsureResult>;
  /** A thumbnail for `ref`: the PNG, else the whole video if cached, else the video's head. */
  preview(ref: string, target: TargetSize): Promise<PreviewResult>;
  /** The file a cache name names, or `null` for anything that is not a cache name. */
  fileFor(relative: string): string | null;
  /** Remove part files abandoned by an earlier run. Resolves how many went. */
  sweep(): Promise<number>;
}

export interface TargetSize {
  readonly width: number;
  readonly height: number;
}

/** What a download fetches, and what makes it acceptable. */
type Kind = 'video' | 'image' | 'head';

const PROVIDER_FOLDER = 'thermalright';
/** A cache name: the only shape `fileFor` resolves. No `..`, no separator but the two. */
const CACHE_NAME =
  /^thermalright\/([0-9]{1,5})x([0-9]{1,5})\/([a-z][0-9]{3})\.(mp4|png|head\.mp4)$/;

export function createBackgroundCache(options: BackgroundCacheOptions): BackgroundCache {
  const { root, urlFor } = options;
  const servers = options.servers ?? BACKGROUND_SERVERS;
  const limits: BackgroundCacheLimits = { ...DEFAULT_BACKGROUND_LIMITS, ...options.limits };
  const log = options.log ?? (() => undefined);
  const inFlight = new Map<string, Promise<DownloadOutcome>>();
  const queue = createQueue(limits.concurrency);

  const fileOf = (relative: string): string => join(root, ...relative.split('/'));

  /** The download of `relative`, joined if one is already running. */
  function download(
    relative: string,
    remote: string,
    kind: Kind,
    size: HostedSize,
  ): Promise<DownloadOutcome> {
    const running = inFlight.get(relative);
    if (running !== undefined) return running;
    const started = queue(() =>
      fetchFromServers({
        servers,
        size,
        remote,
        kind,
        target: fileOf(relative),
        limits,
        fetch: options.fetch,
      }),
    ).finally(() => {
      inFlight.delete(relative);
    });
    inFlight.set(relative, started);
    return started;
  }

  async function ensure(ref: string, target: TargetSize): Promise<EnsureResult> {
    const request = resolveRequest(ref, target);
    if (!request.ok) return request;
    const { id, size } = request;
    const relative = `${PROVIDER_FOLDER}/${sizeName(size)}/${id}.mp4`;
    const path = fileOf(relative);
    const answer = (from: string): EnsureResult => ({
      ok: true,
      url: urlFor(relative),
      path,
      size,
      from,
    });

    if (await hasFile(path)) {
      log(`backgrounds: ${ref} at ${sizeName(size)}: cache hit ${path}`);
      return answer('cache');
    }
    const began = Date.now();
    const outcome = await download(relative, `${id}.mp4`, 'video', size);
    if (!outcome.ok) {
      log(`backgrounds: ${ref} at ${sizeName(size)}: ${outcome.code}: ${outcome.reason}`);
      return atSize(outcome, size);
    }
    log(
      `backgrounds: ${ref} at ${sizeName(size)}: downloaded ${String(outcome.bytes)} bytes from ` +
        `${outcome.server} in ${String(Date.now() - began)} ms -> ${path}`,
    );
    return answer(outcome.server);
  }

  async function preview(ref: string, target: TargetSize): Promise<PreviewResult> {
    const request = resolveRequest(ref, target);
    if (!request.ok) return request;
    const { id, size } = request;
    const folder = `${PROVIDER_FOLDER}/${sizeName(size)}`;
    const png = `${folder}/${id}.png`;
    const video = `${folder}/${id}.mp4`;
    const head = `${folder}/${id}.head.mp4`;
    const marker = fileOf(`${folder}/${id}.nopng`);

    if (await hasFile(fileOf(png))) return { ok: true, kind: 'image', url: urlFor(png) };
    if (await hasFile(fileOf(video))) return { ok: true, kind: 'video', url: urlFor(video) };
    if (await hasFile(fileOf(head))) return { ok: true, kind: 'video', url: urlFor(head) };

    if (!(await hasFile(marker))) {
      const image = await download(png, `${id}.png`, 'image', size);
      if (image.ok) {
        log(`backgrounds: ${ref} preview at ${sizeName(size)}: the PNG, from ${image.server}`);
        return { ok: true, kind: 'image', url: urlFor(png) };
      }
      if (image.code !== 'not-found') return image;
      await mkdir(join(marker, '..'), { recursive: true });
      await writeFile(marker, `${image.reason}\n`);
    }

    const headed = await download(head, `${id}.mp4`, 'head', size);
    if (!headed.ok) return atSize(headed, size);
    log(
      `backgrounds: ${ref} preview at ${sizeName(size)}: no PNG, the first ` +
        `${String(headed.bytes)} bytes of the video, from ${headed.server}`,
    );
    return { ok: true, kind: 'video', url: urlFor(head) };
  }

  return {
    root,
    ensure,
    preview,
    fileFor: (relative) => (CACHE_NAME.test(relative) ? fileOf(relative) : null),
    sweep: () => sweepParts(join(root, PROVIDER_FOLDER)),
  };
}

type Resolved =
  { readonly ok: true; readonly id: string; readonly size: HostedSize } | BackgroundFailure;

/** The id and the hosted size, or why this cache will not ask anyone for them. */
function resolveRequest(ref: unknown, target: unknown): Resolved {
  const parsed = typeof ref === 'string' ? parseBackgroundRef(ref) : null;
  if (parsed === null) {
    return invalid(`not a background reference: ${JSON.stringify(ref)}`);
  }
  if (!isCatalogued(parsed.id)) {
    return invalid(`${backgroundRef(parsed.id)} is not in the catalogue`);
  }
  const size =
    typeof target === 'object' && target !== null ? (target as Record<string, unknown>) : {};
  const whole = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= LAYOUT_MAX_DIMENSION;
  const width = size['width'];
  const height = size['height'];
  if (!whole(width) || !whole(height)) {
    return invalid(`the target must be whole pixels from 1 to ${String(LAYOUT_MAX_DIMENSION)}`);
  }

  return { ok: true, id: parsed.id, size: pickHostedSize({ width, height }) };
}

/**
 * A 404 from both servers, said as what it means. Thermalright hosts each item at some sizes and not
 * others (`a042` is at 480x480 and not at 1920x440), and the size is the rule's, not the author's,
 * so the reason names it rather than leaving "HTTP 404" to read as a broken link.
 */
function atSize(failure: BackgroundFailure, size: HostedSize): BackgroundFailure {
  return failure.code === 'not-found'
    ? { ...failure, reason: `not hosted at ${sizeName(size)} (${failure.reason})` }
    : failure;
}

function invalid(reason: string): BackgroundFailure {
  return { ok: false, code: 'invalid', reason };
}

type DownloadOutcome =
  { readonly ok: true; readonly server: string; readonly bytes: number } | BackgroundFailure;

/** One server's answer, or the reason it gave none. */
type Attempt =
  | { readonly ok: true; readonly bytes: number }
  | {
      readonly ok: false;
      readonly code: Exclude<BackgroundFailureCode, 'invalid'>;
      readonly reason: string;
    };

/** Try each server in turn until one yields the file; else say what each did. */
async function fetchFromServers(options: {
  readonly servers: readonly BackgroundServer[];
  readonly size: HostedSize;
  readonly remote: string;
  readonly kind: Kind;
  readonly target: string;
  readonly limits: BackgroundCacheLimits;
  readonly fetch: FetchLike;
}): Promise<DownloadOutcome> {
  const { servers, limits } = options;
  const failures: { readonly server: string; readonly attempt: Attempt & { ok: false } }[] = [];

  for (const [position, server] of servers.entries()) {
    const timeout =
      limits.timeoutsMs[Math.min(position, limits.timeoutsMs.length - 1)] ??
      DEFAULT_BACKGROUND_LIMITS.timeoutsMs[0] ??
      30_000;
    const attempt = await fetchOnce({
      ...options,
      url: `${server.folder(options.size)}${options.remote}`,
      timeoutMs: timeout,
    });
    if (attempt.ok) return { ok: true, server: server.name, bytes: attempt.bytes };
    failures.push({ server: server.name, attempt });
  }

  const reason = failures.map(({ server, attempt }) => `${server}: ${attempt.reason}`).join('; ');
  const codes = new Set(failures.map(({ attempt }) => attempt.code));
  // The most specific story wins: something wrong came back, else nobody has it, else nobody answered.
  const code: BackgroundFailureCode = codes.has('too-large')
    ? 'too-large'
    : codes.has('bad-content')
      ? 'bad-content'
      : codes.size === 1 && codes.has('not-found')
        ? 'not-found'
        : 'unreachable';

  return { ok: false, code, reason: reason === '' ? 'no servers configured' : reason };
}

async function fetchOnce(options: {
  readonly url: string;
  readonly kind: Kind;
  readonly target: string;
  readonly limits: BackgroundCacheLimits;
  readonly fetch: FetchLike;
  readonly timeoutMs: number;
}): Promise<Attempt> {
  const { kind, target, limits } = options;
  const cap =
    kind === 'image'
      ? limits.maxImageBytes
      : kind === 'head'
        ? limits.headBytes
        : limits.maxVideoBytes;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);
  const part = join(
    target,
    '..',
    `.${target.split(/[\\/]/).pop() ?? 'file'}.${randomBytes(6).toString('hex')}.part`,
  );
  let wrote = false;

  try {
    const response = await options.fetch(options.url, {
      signal: controller.signal,
      ...(kind === 'head' ? { headers: { range: `bytes=0-${String(limits.headBytes - 1)}` } } : {}),
    });
    const accepted = response.status === 200 || (kind === 'head' && response.status === 206);
    if (!accepted) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        code: response.status === 404 ? 'not-found' : 'unreachable',
        reason: `HTTP ${String(response.status)}`,
      };
    }

    const declared = Number(response.headers.get('content-length') ?? Number.NaN);
    if (kind !== 'head' && Number.isFinite(declared) && declared > cap) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        code: 'too-large',
        reason: `declared ${String(declared)} bytes, over the ${String(cap)} cap`,
      };
    }
    if (response.body === null)
      return { ok: false, code: 'unreachable', reason: 'an empty response' };

    await mkdir(join(target, '..'), { recursive: true });
    const file = await open(part, 'wx');
    wrote = true;
    let bytes = 0;
    let first: Uint8Array = new Uint8Array(0);
    let truncated = false;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        let chunk = value;
        if (bytes + chunk.byteLength > cap) {
          if (kind !== 'head') {
            await reader.cancel().catch(() => undefined);
            return {
              ok: false,
              code: 'too-large',
              reason: `more than the ${String(cap)} byte cap`,
            };
          }
          chunk = chunk.subarray(0, cap - bytes);
          truncated = true;
        }
        if (first.byteLength < 16) first = concat(first, chunk.subarray(0, 16 - first.byteLength));
        await file.write(chunk);
        bytes += chunk.byteLength;
        if (truncated) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
      await file.sync();
    } finally {
      await file.close();
    }

    // A declared length is a promise about the body; a range reply declares the range's length.
    if (!truncated && Number.isFinite(declared) && bytes !== declared) {
      return {
        ok: false,
        code: 'unreachable',
        reason: `ended after ${String(bytes)} of ${String(declared)} bytes`,
      };
    }
    if (bytes === 0) return { ok: false, code: 'unreachable', reason: 'an empty body' };
    if (!looksLike(kind, first)) {
      return {
        ok: false,
        code: 'bad-content',
        reason: `not ${kind === 'image' ? 'a PNG' : 'an MP4'}`,
      };
    }

    await rename(part, target);
    wrote = false;
    return { ok: true, bytes };
  } catch (error) {
    return {
      ok: false,
      code: 'unreachable',
      reason: controller.signal.aborted
        ? `timed out after ${String(options.timeoutMs)} ms`
        : describe(error),
    };
  } finally {
    clearTimeout(timer);
    if (wrote) await unlink(part).catch(() => undefined);
  }
}

/** An MP4 opens with a box whose type is `ftyp`; a PNG with its eight-byte signature. */
function looksLike(kind: Kind, first: Uint8Array): boolean {
  if (kind === 'image') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => first[index] === byte);
  }
  return String.fromCharCode(...first.subarray(4, 8)) === 'ftyp';
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const joined = new Uint8Array(a.byteLength + b.byteLength);
  joined.set(a);
  joined.set(b, a.byteLength);
  return joined;
}

async function hasFile(path: string): Promise<boolean> {
  try {
    const found = await stat(path);
    return found.isFile() && found.size > 0;
  } catch {
    return false;
  }
}

async function sweepParts(folder: string): Promise<number> {
  let sizes: string[];
  try {
    sizes = await readdir(folder);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const size of sizes) {
    let names: string[];
    try {
      names = await readdir(join(folder, size));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith('.') || !name.endsWith('.part')) continue;
      const path = join(folder, size, name);
      try {
        if (Date.now() - (await stat(path)).mtimeMs < STALE_PART_MS) continue;
        await unlink(path);
        removed += 1;
      } catch {
        // Gone already, or in use by another process's rename: either way not ours to report.
      }
    }
  }
  return removed;
}

/** Run at most `limit` tasks at once, the rest in the order they arrived. */
function createQueue(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  const next = (): void => {
    running -= 1;
    waiting.shift()?.();
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = (): void => {
        running += 1;
        task().then(resolve, reject).finally(next);
      };
      if (running < Math.max(1, limit)) start();
      else waiting.push(start);
    });
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}
