/**
 * The decisions `dev-stack.mjs` makes before and around spawning anything, as pure functions.
 *
 * Split out of `dev-stack.mjs` for one reason: that file is a script with top-level `await` and
 * side effects from its first line, so nothing in it can be imported by a test without starting a
 * dev stack. Everything here is a function of its arguments — argv, the environment, a directory
 * listing, a probe result — so `dev-startup.test.mjs` asserts the *wording* of every startup
 * message without binding a port or spawning a process. The wording is the deliverable: a message
 * nobody has read is a message nobody has checked.
 *
 * Stdlib only, and in fact no imports at all. `dev-stack.mjs`'s header explains why a process
 * runner is not a dependency here; the same argument covers an argument parser and a word
 * wrapper, both of which are a dozen lines.
 */

/** Vite's own default, and the runtime's port since before there was a stack. */
export const DEFAULT_RUNTIME_PORT = 5173;

/** The editor's port, fixed in `apps/editor/vite.config.ts` for the reason stated there. */
export const DEFAULT_EDITOR_PORT = 5402;

/**
 * How wide a startup message may be, and how far its text is indented from the label column.
 *
 * 88 because these messages are read in the terminal the stack runs in, next to Vite's own output,
 * and a line that wraps where the terminal chooses rather than where the text chooses loses the
 * label alignment that makes the banner scannable in one look.
 */
const LINE_WIDTH = 88;
const LABEL_WIDTH = 12;

/**
 * The two ports this stack hands to Vite, and where each one may come from.
 *
 * `flag -> environment variable -> default`, which is the resolution order the relay already
 * documents in README.md. One order for every setting in the project is worth more than each
 * setting picking the order that suits it.
 */
const PORT_SETTINGS = [
  {
    key: 'runtimePort',
    flag: '--runtime-port',
    env: 'PERCH_RUNTIME_PORT',
    label: 'runtime',
    fallback: DEFAULT_RUNTIME_PORT,
  },
  {
    key: 'editorPort',
    flag: '--editor-port',
    env: 'PERCH_EDITOR_PORT',
    label: 'editor',
    fallback: DEFAULT_EDITOR_PORT,
  },
];

export const USAGE = [
  'npm run dev -- [options]    the editor and the runtime, one terminal',
  '',
  '  --editor-port <port>   where the editor listens (default 5402, or PERCH_EDITOR_PORT)',
  '  --runtime-port <port>  where the runtime listens (default 5173, or PERCH_RUNTIME_PORT)',
  '  --relay                also start the relay, whatever the environment says',
  '  --no-relay             never start the relay',
  '  -h, --help             this list',
  '',
  'Without --relay or --no-relay the relay starts only when PERCH_BROKER_URL or',
  'PERCH_LHM_HOST is set, because those are the only settings that give it a reader.',
].join('\n');

/**
 * Wrap `text` to the body column, as a list of lines with no indent of their own.
 *
 * Greedy, and it never breaks a word: the things most likely to be long here are a URL and a
 * `PERCH_`-something, and both are worth more unbroken on an over-long line than split across two.
 */
function wrap(text, width = LINE_WIDTH - LABEL_WIDTH) {
  const lines = [];
  let line = '';

  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/**
 * A label and its paragraphs, aligned: the label in its own column, every following line indented
 * to where the first one started.
 */
function labelled(label, paragraphs) {
  const body = paragraphs.flatMap((paragraph) => wrap(paragraph));
  const indent = ' '.repeat(LABEL_WIDTH);
  const head = `  ${label}`.padEnd(LABEL_WIDTH, ' ');

  return body.map((line, index) => `${index === 0 ? head : indent}${line}`);
}

/** A port number, or `null` with the reason it is not one. */
function parsePort(text) {
  if (!/^\d+$/.test(text)) return { ok: false, reason: `${text} is not a number` };
  const port = Number(text);
  if (port === 0) {
    return {
      ok: false,
      reason:
        '0 asks the operating system to pick, and this stack has to print a URL you can navigate to',
    };
  }
  if (port > 65535) return { ok: false, reason: `${text} is above the highest port, 65535` };
  return { ok: true, port };
}

/** `--x=1` as `['--x', '1']`; `--x` as `['--x', undefined]`. */
function splitFlag(token) {
  const at = token.indexOf('=');
  return at === -1 ? [token, undefined] : [token.slice(0, at), token.slice(at + 1)];
}

/**
 * What the stack was asked to do, or a single sentence saying why the request makes no sense.
 *
 * A malformed value is a refusal rather than a fall-through to the default, for the reason the
 * relay's config gives about `--lhm-port banana`: a typo that silently starts something on the
 * wrong port is worse than a typo that stops.
 *
 * @returns {{ok: true, options: object} | {ok: false, message: string}}
 */
export function parseStackOptions(argv, env = {}) {
  const fromFlag = {};
  let relay = 'auto';
  let help = false;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const [name, inline] = splitFlag(token);
    const setting = PORT_SETTINGS.find((candidate) => candidate.flag === name);

    if (setting !== undefined) {
      const value = inline ?? argv[index + 1];
      if (inline === undefined) index++;
      if (value === undefined || value.startsWith('-')) {
        return { ok: false, message: `${name} needs a port number after it` };
      }
      const parsed = parsePort(value);
      if (!parsed.ok) return { ok: false, message: `${name}: ${parsed.reason}` };
      fromFlag[setting.key] = parsed.port;
      continue;
    }

    if (name === '--relay') relay = 'on';
    else if (name === '--no-relay') relay = 'off';
    else if (name === '--help' || name === '-h') help = true;
    else {
      return {
        ok: false,
        message: `${token} is not an option this stack knows. Run with --help for the list.`,
      };
    }
  }

  const ports = {};
  for (const setting of PORT_SETTINGS) {
    const fromEnv = env[setting.env];
    if (fromFlag[setting.key] !== undefined) {
      ports[setting.key] = fromFlag[setting.key];
    } else if (typeof fromEnv === 'string' && fromEnv.length > 0) {
      const parsed = parsePort(fromEnv);
      if (!parsed.ok) return { ok: false, message: `${setting.env}: ${parsed.reason}` };
      ports[setting.key] = parsed.port;
    } else {
      ports[setting.key] = setting.fallback;
    }
  }

  if (ports.runtimePort === ports.editorPort) {
    return {
      ok: false,
      message:
        `the editor and the runtime are both set to port ${ports.runtimePort}, and they are two ` +
        `servers. Give one of them another port.`,
    };
  }

  return { ok: true, options: { help, relay, ...ports } };
}

/** The port settings, so `dev-stack.mjs` can name the flag and variable for a port it checked. */
export function portSettings(options) {
  return PORT_SETTINGS.map((setting) => ({
    label: setting.label,
    flag: setting.flag,
    env: setting.env,
    port: options[setting.key],
  }));
}

/**
 * Whether to start the relay, and the sentence the banner shows about it either way.
 *
 * The default is conditional rather than always-on, and that is the one behaviour change here
 * worth arguing for. `PERCH_BROKER_URL` decides which source the page reads and nothing else does
 * — README.md states that, and an unset variable means the page reads its generated mock. So a
 * relay started into an unset environment serves a broker that this stack's own page will not
 * dial: it costs a `tsc -b`, it can prompt about somebody's Mosquitto, and against a sensor host
 * that is switched off it writes `[error] poll failed` into the first screen of a startup that
 * worked. Three costs, no reader.
 *
 * `--relay` still starts it into that environment, because "I want the broker up" is a real thing
 * to want; it just says plainly that the page is still on mock data.
 */
export function decideRelay(mode, env = {}) {
  const brokerUrl = env.PERCH_BROKER_URL ?? '';
  const lhmHost = env.PERCH_LHM_HOST ?? '';
  const pageReadsRelay = brokerUrl.length > 0;

  if (mode === 'off') {
    return {
      start: false,
      note: pageReadsRelay
        ? `Not started (--no-relay), but PERCH_BROKER_URL is set to ${brokerUrl}, so the page will try to dial a broker that is not there and show its error badge.`
        : 'Not started (--no-relay). The page reads generated mock data.',
    };
  }

  if (mode === 'auto' && !pageReadsRelay && lhmHost.length === 0) {
    return {
      start: false,
      note: 'Not started: PERCH_BROKER_URL is unset, so the page reads generated mock data and nothing would read the relay. Add --relay to start it anyway, or set PERCH_BROKER_URL=ws://localhost:9001 to point the page at it.',
    };
  }

  return {
    start: true,
    note: pageReadsRelay
      ? `Started. The page dials ${brokerUrl}.`
      : 'Started, but PERCH_BROKER_URL is unset, so the page still reads generated mock data rather than this relay. Set it to ws://localhost:9001 to change that.',
  };
}

/**
 * What the relay's log is about to say about the sensor host, given a reachability probe.
 *
 * This exists because of one specific misreading: with the host switched off — the usual state of
 * the machine this was written for — the relay logs `[error] poll failed: ...` within a second of
 * starting, and two red lines under a banner read as a startup that failed. It did not fail. So
 * the expectation is set *before* the line appears, in the same breath as the URLs.
 *
 * `reachable` is a probe result rather than a guess, and `null` means the probe could not answer
 * (no permission, no resolver), in which case nothing is claimed.
 */
export function describeSensorHost({ host, port, reachable }) {
  const endpoint = `http://${host}:${port}/data.json`;

  if (reachable === true) return `Polling ${endpoint}, which is answering.`;
  if (reachable === null) return `Polling ${endpoint}.`;

  return `Polling ${endpoint}, where nothing is listening. Expect an "[error] poll failed" line, then a summary on a widening interval: that is the relay reporting an outage without repeating itself once a second, not a failed startup. The broker is up, the poll keeps retrying, and powering the sensor host on is all it needs.`;
}

/**
 * Which layouts the pages will offer, and which of them will not open.
 *
 * `offered` mirrors `apps/runtime/src/layout-catalogue.ts` exactly — `layouts/*.json`, sorted,
 * first is the default — because the banner listing a different set from the picker would be a
 * worse lie than listing nothing.
 *
 * The check is **JSON parseability and nothing else**. A layout can be well-formed JSON and still
 * not be a layout, and that deeper check belongs to `loadLayoutJson` against `WIDGET_REGISTRY`,
 * which is a React package: importing it into this Node script would couple startup to `ui-kit`
 * running outside a browser and to a `tsc -b` having been done first. `apps/editor/vite.config.ts`
 * refuses the same import for the same reason. The pages already print schema issues where an
 * author can read them; what they cannot do is warn you before you pick the file.
 *
 * @param files `[{ file: 'desk-1920x400.json', text }]`, as read from `layouts/`.
 */
export function classifyLayouts(files) {
  const names = [];
  const unopenable = [];

  for (const { file, text } of [...files].sort((a, b) => a.file.localeCompare(b.file))) {
    if (!file.endsWith('.json')) continue;
    const name = file.slice(0, -'.json'.length);
    names.push(name);
    try {
      JSON.parse(text);
    } catch (error) {
      unopenable.push({ name, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { names, unopenable };
}

/**
 * The block the banner prints about `layouts/`.
 *
 * An empty directory is called out rather than printed as a blank: the runtime with no layouts
 * refuses with `unknown-layout` for every URL, and "no layouts" is a far quicker read of that than
 * the page's own refusal is.
 */
export function describeLayouts({ names, unopenable }) {
  if (names.length === 0) {
    return ['No .json files in layouts/, so both pages will refuse every ?layout= you give them.'];
  }

  const paragraphs = [
    names.join(', '),
    `Add ?layout=<name> to either URL for a specific one; without it each page opens ${names[0]}.`,
  ];

  for (const { name, reason } of unopenable) {
    paragraphs.push(
      `${name}.json is not parseable JSON (${reason}), so the page will refuse it and print that where you can read it. The others are unaffected.`,
    );
  }

  return paragraphs;
}

/**
 * The whole banner, printed once both dev servers have answered.
 *
 * Printed *last* on purpose. The complaint this whole change answers is that startup "tells you
 * nothing about where to go", and a banner printed before Vite's own output is a banner that has
 * scrolled off by the time the servers are up.
 */
export function formatBanner({ editorUrl, runtimeUrl, layouts, relayNote }) {
  return [
    '',
    'perch dev stack',
    '',
    `  ${'editor'.padEnd(LABEL_WIDTH - 2, ' ')}${editorUrl}`,
    `  ${'runtime'.padEnd(LABEL_WIDTH - 2, ' ')}${runtimeUrl}`,
    ...labelled('', [
      'Author in the editor and save; the runtime tab reloads, because the save writes the real layouts/<name>.json and the runtime watches it.',
    ]),
    '',
    ...labelled('layouts', describeLayouts(layouts)),
    '',
    ...labelled('relay', [relayNote]),
    '',
    '  Ctrl-C stops everything this started.',
    '',
  ].join('\n');
}

/**
 * Why the stack did not start, when a port it needs is held.
 *
 * The behaviour being explained is deliberate and stays: both dev servers set `strictPort`, so a
 * held port is a refusal rather than a quiet move to the next one, because a capture navigates to
 * a fixed URL and a server that drifted turns a screenshot into a picture of whatever else was
 * listening. `apps/editor/vite.config.ts` and `apps/runtime/vite.config.ts` both say so. What Vite
 * gives you for it is `Error: Port 5173 is already in use` over six frames of its own stack, which
 * names neither the holder nor either way out. This does both.
 *
 * @param clashes `[{ port, label, flag, env, suggestion, holder }]`, holder `{pid, command}|null`.
 */
export function formatPortClash(clashes) {
  const lines = [
    '',
    'perch dev stack did not start: a port it needs is taken.',
    '',
    ...wrap(
      'Both dev servers use a fixed port on purpose: a capture has to navigate to a known URL, so neither drifts to the next free one. For each port below, either free it or move this stack off it.',
      LINE_WIDTH - 2,
    ).map((line) => `  ${line}`),
  ];

  for (const { port, label, flag, env, suggestion, holder } of clashes) {
    lines.push('', `  ${String(port).padEnd(6, ' ')}wanted by the ${label}`);
    if (holder === null) {
      lines.push('        held by something lsof would not name');
    } else {
      lines.push(`        held by pid ${holder.pid}`, `        ${holder.command}`);
      lines.push(`        free it:  kill ${holder.pid}`);
    }
    lines.push(`        or move:  npm run dev -- ${flag} ${suggestion}`);
    lines.push(`        or set:   export ${env}=${suggestion}`);
  }

  lines.push('');
  return lines.join('\n');
}
