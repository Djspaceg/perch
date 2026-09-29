/**
 * What the desktop app remembers between launches: which layout document was open, which
 * LibreHardwareMonitor host the relay was last told to poll, and the editor's recent documents.
 *
 * One small JSON file in Electron's `userData`, rather than a settings library, because three fields
 * do not need one. Two properties matter and both are here:
 *
 * - **A write is atomic.** The new contents go to a temporary file beside the real one and are
 *   renamed over it, and a rename within one directory is atomic on every platform this runs on.
 *   A crash or a power cut mid-write leaves the previous settings, never half of the new ones.
 * - **A bad file is not fatal.** A settings file somebody edited by hand, or one from a future
 *   version, reads as the defaults for whatever it got wrong, and the problem is reported rather
 *   than thrown: the runner still has to start and show a dashboard.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseLhmRequest } from '@perch/agent';
import { RECENT_LIMIT } from './recent.js';

/** The file's name inside `userData`. */
export const SETTINGS_FILENAME = 'perch-desktop.json';

/** An LHM host as the relay polls it. */
export interface LhmHostSetting {
  readonly host: string;
  readonly port: number;
}

export interface DesktopSettings {
  /** Absolute path of the layout document open at last quit, or `null` before the first one. */
  readonly lastDocument: string | null;
  /** The LHM host a client last switched the relay to, or `null` for the relay's own default. */
  readonly lhm: LhmHostSetting | null;
  /** File > Open recent: absolute paths, newest first, at most `RECENT_LIMIT` (`recent.ts`). */
  readonly recent: readonly string[];
}

export const DEFAULT_SETTINGS: DesktopSettings = Object.freeze({
  lastDocument: null,
  lhm: null,
  recent: Object.freeze([]),
});

export interface SettingsRead {
  readonly settings: DesktopSettings;
  /** What was wrong with the file, for the log, or `null` when it was fine or absent. */
  readonly problem: string | null;
}

/** Read the file. Never throws for a missing or malformed file; see the module comment. */
export async function readSettings(file: string): Promise<SettingsRead> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return { settings: DEFAULT_SETTINGS, problem: null };
    return { settings: DEFAULT_SETTINGS, problem: `could not read ${file}: ${describe(error)}` };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    return { settings: DEFAULT_SETTINGS, problem: `${file} is not JSON: ${describe(error)}` };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { settings: DEFAULT_SETTINGS, problem: `${file} is not a JSON object` };
  }

  const { lastDocument, lhm, recent } = body as {
    lastDocument?: unknown;
    lhm?: unknown;
    recent?: unknown;
  };
  const bad: string[] = [];

  const lastOk = lastDocument === null || typeof lastDocument === 'string';
  if (!lastOk && lastDocument !== undefined) bad.push('lastDocument');

  const lhmOk = lhm === null || isLhmHostSetting(lhm);
  if (!lhmOk && lhm !== undefined) bad.push('lhm');

  // A file from before the list has none, which is an empty one; anything else that is not a list
  // of paths keeps the paths it has.
  const listed = Array.isArray(recent) ? (recent as unknown[]) : [];
  const paths = listed.filter((path): path is string => typeof path === 'string' && path !== '');
  if ((recent !== undefined && !Array.isArray(recent)) || paths.length !== listed.length) {
    bad.push('recent');
  }

  return {
    settings: {
      lastDocument: lastOk ? lastDocument : null,
      lhm: lhmOk ? lhm : null,
      recent: paths.slice(0, RECENT_LIMIT),
    },
    problem: bad.length === 0 ? null : `${file}: ignored ${bad.join(', ')}, which did not parse`,
  };
}

/** Counter for temporary names, so two writes in one process never share one. */
let writeCount = 0;

/** Write the file atomically, creating its directory if need be. */
export async function writeSettings(file: string, settings: DesktopSettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true });

  writeCount += 1;
  const temporary = `${file}.${String(process.pid)}.${String(writeCount)}.tmp`;
  const body: DesktopSettings = {
    lastDocument: settings.lastDocument,
    lhm: settings.lhm,
    recent: settings.recent,
  };

  try {
    await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export interface SettingsStore {
  /** The settings as last loaded or updated. The defaults until `load` resolves. */
  readonly current: DesktopSettings;
  load(): Promise<SettingsRead>;
  /**
   * Change some fields and persist the result.
   *
   * Updates are queued, so overlapping calls write in the order they were made and the file ends
   * as the last one left it. A failed write rejects that call and does not stop the queue.
   */
  update(patch: Partial<DesktopSettings>): Promise<void>;
}

export function createSettingsStore(file: string): SettingsStore {
  let current = DEFAULT_SETTINGS;
  let queue: Promise<void> = Promise.resolve();

  return {
    get current() {
      return current;
    },
    load: async () => {
      const read = await readSettings(file);
      current = read.settings;
      return read;
    },
    update: (patch) => {
      current = { ...current, ...patch };
      const snapshot = current;
      const write = queue.then(() => writeSettings(file, snapshot));
      queue = write.catch(() => undefined);
      return write;
    },
  };
}

/**
 * Through the relay's own request parser, so a value read back from here can never be a host or
 * port the relay would have refused from a client.
 */
function isLhmHostSetting(candidate: unknown): candidate is LhmHostSetting {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { host, port } = candidate as { host?: unknown; port?: unknown };
  if (typeof port !== 'number') return false;

  const parsed = parseLhmRequest(JSON.stringify({ host, port }), port);
  return parsed !== null && parsed.host === host && parsed.port === port;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
