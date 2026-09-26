/**
 * The startup decisions and the startup messages, asserted without starting anything.
 *
 * Every case here is a failure a human actually hits: a port held by another checkout, a typo in a
 * flag, a sensor host that is switched off, a layout file somebody hand-edited into invalid JSON.
 * The assertions are mostly about *wording*, which is unusual and is the point — the thing being
 * fixed is what startup says, so the tests have to be able to fail when it says the wrong thing.
 * They check for the specific phrase that carries the information (the pid, the flag, the variable,
 * "not a failed startup") rather than the whole paragraph, so rewording a sentence does not break a
 * test while deleting the fact it carries does.
 *
 * What is *not* here: anything that needs a listening socket or a child process. Binding a port to
 * prove a bind probe works would be testing `node:net`, and spawning two Vite servers to prove they
 * come up is what the captured run in the evidence directory does instead.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_PORT,
  DEFAULT_RUNTIME_PORT,
  EDITOR_RELAY_URL_ENV_VAR,
  classifyLayouts,
  decideRelay,
  describeLayouts,
  describeSensorHost,
  formatBanner,
  formatPortClash,
  editorRelayEnv,
  parseBrokerListening,
  parseStackOptions,
  portSettings,
  relayListenArgs,
} from './dev-startup.mjs';

/** Unwrap an expected-good parse, so a broken parse fails on the assertion and not a `.options`. */
function options(argv, env = {}) {
  const parsed = parseStackOptions(argv, env);
  expect(parsed).toMatchObject({ ok: true });
  return parsed.options;
}

describe('parseStackOptions', () => {
  it('defaults to both dev servers on their fixed ports, relay decided by the environment', () => {
    expect(options([])).toEqual({
      help: false,
      relay: 'auto',
      runtimePort: DEFAULT_RUNTIME_PORT,
      editorPort: DEFAULT_EDITOR_PORT,
    });
  });

  it('takes a port as a separate argument or with an equals sign', () => {
    expect(options(['--runtime-port', '5502']).runtimePort).toBe(5502);
    expect(options(['--editor-port=5512']).editorPort).toBe(5512);
  });

  it('reads a port from the environment, and lets the flag win over it', () => {
    expect(options([], { PERCH_RUNTIME_PORT: '5502' }).runtimePort).toBe(5502);
    expect(options(['--runtime-port', '5600'], { PERCH_RUNTIME_PORT: '5502' }).runtimePort).toBe(
      5600,
    );
  });

  it('ignores an empty environment variable rather than treating it as a port', () => {
    expect(options([], { PERCH_EDITOR_PORT: '' }).editorPort).toBe(DEFAULT_EDITOR_PORT);
  });

  it('refuses a port that is not a number instead of falling through to the default', () => {
    const parsed = parseStackOptions(['--runtime-port', 'banana']);
    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain('--runtime-port');
    expect(parsed.message).toContain('banana is not a number');
  });

  it('names the environment variable when that is where the bad port came from', () => {
    const parsed = parseStackOptions([], { PERCH_EDITOR_PORT: '99999' });
    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain('PERCH_EDITOR_PORT');
    expect(parsed.message).toContain('65535');
  });

  it('refuses port 0, because the banner has to print a URL', () => {
    const parsed = parseStackOptions(['--editor-port', '0']);
    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain('operating system to pick');
  });

  it('refuses a port flag with nothing after it, including another flag', () => {
    expect(parseStackOptions(['--runtime-port']).message).toContain('needs a port number');
    expect(parseStackOptions(['--runtime-port', '--relay']).message).toContain(
      'needs a port number',
    );
  });

  it('refuses two servers on one port', () => {
    const parsed = parseStackOptions(['--editor-port', '5173']);
    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain('5173');
    expect(parsed.message).toContain('two');
  });

  it('refuses an unknown option and points at --help', () => {
    const parsed = parseStackOptions(['--with-relay']);
    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain('--with-relay');
    expect(parsed.message).toContain('--help');
  });

  it('carries --relay, --no-relay and --help through', () => {
    expect(options(['--relay']).relay).toBe('on');
    expect(options(['--no-relay']).relay).toBe('off');
    expect(options(['-h']).help).toBe(true);
    expect(options(['--help']).help).toBe(true);
  });

  it('reports each port with the flag and variable that set it', () => {
    expect(portSettings(options([]))).toEqual([
      { label: 'runtime', flag: '--runtime-port', env: 'PERCH_RUNTIME_PORT', port: 5173 },
      { label: 'editor', flag: '--editor-port', env: 'PERCH_EDITOR_PORT', port: 5402 },
    ]);
  });
});

describe('decideRelay', () => {
  it('starts the relay by default, because the editor reads it for its connection control', () => {
    const decision = decideRelay('auto', {});
    expect(decision.start).toBe(true);
    expect(decision.note).toContain('editor');
    expect(decision.note).toContain('--no-relay');
  });

  it('says the runtime page stays on mock data unless PERCH_BROKER_URL points it at the relay', () => {
    const decision = decideRelay('auto', {});
    expect(decision.note).toContain('PERCH_BROKER_URL is unset');
    expect(decision.note).toContain('mock data');
  });

  it('names the broker URL the runtime page dials when it is set', () => {
    const decision = decideRelay('auto', { PERCH_BROKER_URL: 'ws://localhost:9001' });
    expect(decision.start).toBe(true);
    expect(decision.note).toContain('ws://localhost:9001');
  });

  it('starts the relay for --relay as well', () => {
    expect(decideRelay('on', {}).start).toBe(true);
  });

  it('leaves it out for --no-relay, and says the editor then has only sample data', () => {
    const decision = decideRelay('off', {});
    expect(decision.start).toBe(false);
    expect(decision.note).toContain('sample data');
  });

  it('warns that the page will show an error badge when --no-relay contradicts PERCH_BROKER_URL', () => {
    const decision = decideRelay('off', { PERCH_BROKER_URL: 'ws://localhost:9001' });
    expect(decision.start).toBe(false);
    expect(decision.note).toContain('ws://localhost:9001');
    expect(decision.note).toContain('error badge');
  });
});

describe('relayListenArgs', () => {
  const free = { mqtt: false, ws: false };
  const held = { mqtt: true, ws: true };

  it('passes nothing when the default ports are free, so the relay takes 1883 and 9001', () => {
    expect(relayListenArgs({ env: {}, held: free })).toEqual([]);
  });

  it('moves a held default port to an OS-chosen one instead of dialling whoever holds it', () => {
    expect(relayListenArgs({ env: {}, held })).toEqual(['--mqtt-port', '0', '--ws-port', '0']);
    expect(relayListenArgs({ env: {}, held: { mqtt: false, ws: true } })).toEqual([
      '--ws-port',
      '0',
    ]);
  });

  it('never overrides a port the human chose', () => {
    expect(relayListenArgs({ env: { PERCH_WS_PORT: '19001' }, held })).toEqual([
      '--mqtt-port',
      '0',
    ]);
    expect(
      relayListenArgs({ env: { PERCH_WS_PORT: '19001', PERCH_MQTT_PORT: '11883' }, held }),
    ).toEqual([]);
  });

  it('keeps the fixed ports when the runtime page dials a fixed URL, so a clash still stops', () => {
    expect(relayListenArgs({ env: { PERCH_BROKER_URL: 'ws://localhost:9001' }, held })).toEqual([]);
  });
});

describe('parseBrokerListening', () => {
  it('reads both ports the relay actually bound from its startup line', () => {
    expect(
      parseBrokerListening('broker listening: mqtt://0.0.0.0:53122, ws://0.0.0.0:53123'),
    ).toEqual({ mqttPort: 53122, wsPort: 53123 });
  });

  it('ignores every other line', () => {
    expect(parseBrokerListening('polling http://localhost:8085/data.json')).toBeNull();
    expect(parseBrokerListening('[error] poll failed: ws://0.0.0.0:1')).toBeNull();
  });
});

describe('editorRelayEnv', () => {
  it('hands the editor the URL of the port the relay bound, on localhost', () => {
    expect(editorRelayEnv({ PATH: '/bin' }, 53123)).toEqual({
      PATH: '/bin',
      [EDITOR_RELAY_URL_ENV_VAR]: 'ws://localhost:53123',
    });
    expect(EDITOR_RELAY_URL_ENV_VAR).toBe('PERCH_RELAY_URL');
  });

  it('overrides a stale value in the shell, since only the stack knows the port it got', () => {
    expect(editorRelayEnv({ PERCH_RELAY_URL: 'ws://localhost:9001' }, 60000)).toEqual({
      PERCH_RELAY_URL: 'ws://localhost:60000',
    });
  });
});

describe('describeSensorHost', () => {
  it('says an unreachable host is not a startup failure, because that is the usual case', () => {
    const note = describeSensorHost({ host: 'localhost', port: 8085, reachable: false });
    expect(note).toContain('http://localhost:8085/data.json');
    expect(note).toContain('poll failed');
    expect(note).toContain('not a failed startup');
  });

  it('is brief when the host answers', () => {
    expect(describeSensorHost({ host: '192.168.1.3', port: 8085, reachable: true })).toBe(
      'Polling http://192.168.1.3:8085/data.json, which is answering.',
    );
  });

  it('claims nothing when the probe could not answer', () => {
    expect(describeSensorHost({ host: 'lhm.local', port: 8085, reachable: null })).toBe(
      'Polling http://lhm.local:8085/data.json.',
    );
  });
});

describe('classifyLayouts', () => {
  const valid = JSON.stringify({ schemaVersion: 1 });

  it('offers layouts/*.json sorted, with the first as the default, and ignores other files', () => {
    const { names, unopenable } = classifyLayouts([
      { file: 'tower-720x1280.json', text: valid },
      { file: 'README.md', text: '# layouts' },
      { file: 'desk-1920x400.json', text: valid },
    ]);
    expect(names).toEqual(['desk-1920x400', 'tower-720x1280']);
    expect(unopenable).toEqual([]);
  });

  it('flags a file that is not JSON, keeping it listed because the picker still lists it', () => {
    const { names, unopenable } = classifyLayouts([
      { file: 'desk-1920x400.json', text: valid },
      { file: 'half-saved.json', text: '{ "schemaVersion": 1,' },
    ]);
    expect(names).toEqual(['desk-1920x400', 'half-saved']);
    expect(unopenable).toHaveLength(1);
    expect(unopenable[0].name).toBe('half-saved');
    expect(unopenable[0].reason.length).toBeGreaterThan(0);
  });
});

describe('describeLayouts', () => {
  it('lists the names and how to open one', () => {
    const lines = describeLayouts({ names: ['desk-1920x400', 'trend-1920x400'], unopenable: [] });
    expect(lines[0]).toBe('desk-1920x400, trend-1920x400');
    expect(lines[1]).toContain('?layout=<name>');
    expect(lines[1]).toContain('desk-1920x400');
  });

  it('says which file will not open and that the rest still work', () => {
    const lines = describeLayouts({
      names: ['desk-1920x400'],
      unopenable: [{ name: 'desk-1920x400', reason: 'Unexpected end of JSON input' }],
    });
    expect(lines.join(' ')).toContain('desk-1920x400.json is not parseable JSON');
    expect(lines.join(' ')).toContain('Unexpected end of JSON input');
    expect(lines.join(' ')).toContain('others are unaffected');
  });

  it('calls out an empty layouts directory rather than printing a blank list', () => {
    expect(describeLayouts({ names: [], unopenable: [] })[0]).toContain('No .json files');
  });
});

describe('formatBanner', () => {
  const banner = formatBanner({
    editorUrl: 'http://localhost:5402/',
    runtimeUrl: 'http://localhost:5173/',
    layouts: { names: ['desk-1920x400'], unopenable: [] },
    relayNote: 'Not started: PERCH_BROKER_URL is unset.',
  });

  it('prints both URLs, each on its own labelled line', () => {
    expect(banner).toContain('  editor    http://localhost:5402/');
    expect(banner).toContain('  runtime   http://localhost:5173/');
  });

  it('names the loop the two servers exist to serve', () => {
    expect(banner).toContain('save');
    expect(banner).toContain('layouts/<name>.json');
  });

  it('says how to stop it', () => {
    expect(banner).toContain('Ctrl-C');
  });

  it('wraps to a width a terminal will not re-wrap', () => {
    for (const line of banner.split('\n')) expect(line.length).toBeLessThanOrEqual(88);
  });
});

describe('formatPortClash', () => {
  const clash = formatPortClash([
    {
      port: 5173,
      label: 'runtime',
      flag: '--runtime-port',
      env: 'PERCH_RUNTIME_PORT',
      suggestion: 5502,
      holder: { pid: '54741', command: 'node /Users/x/Source/perch/node_modules/.bin/vite' },
    },
  ]);

  it('names the port, what wanted it, and who holds it', () => {
    expect(clash).toContain('5173');
    expect(clash).toContain('the runtime');
    expect(clash).toContain('pid 54741');
    expect(clash).toContain('/Source/perch/node_modules/.bin/vite');
  });

  it('gives the three ways on, each as a command that can be pasted', () => {
    expect(clash).toContain('kill 54741');
    expect(clash).toContain('npm run dev -- --runtime-port 5502');
    expect(clash).toContain('export PERCH_RUNTIME_PORT=5502');
  });

  it('explains that the fixed port is deliberate, so nobody goes looking for a retry', () => {
    expect(clash).toContain('fixed port on purpose');
  });

  it('is honest when lsof cannot name the holder, and still offers the ways it can', () => {
    const anonymous = formatPortClash([
      {
        port: 5402,
        label: 'editor',
        flag: '--editor-port',
        env: 'PERCH_EDITOR_PORT',
        suggestion: 5512,
        holder: null,
      },
    ]);
    expect(anonymous).toContain('would not name');
    expect(anonymous).not.toContain('kill');
    expect(anonymous).toContain('npm run dev -- --editor-port 5512');
  });

  it('reports both ports when both are taken', () => {
    const both = formatPortClash([
      {
        port: 5173,
        label: 'runtime',
        flag: '--runtime-port',
        env: 'PERCH_RUNTIME_PORT',
        suggestion: 5502,
        holder: null,
      },
      {
        port: 5402,
        label: 'editor',
        flag: '--editor-port',
        env: 'PERCH_EDITOR_PORT',
        suggestion: 5512,
        holder: null,
      },
    ]);
    expect(both).toContain('5173');
    expect(both).toContain('5402');
  });
});
