import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDITOR_SWITCH } from './launch.js';
import {
  APP_ID,
  EDITOR_PRODUCT_NAME,
  PRODUCT_NAME,
  linuxEditorDesktopEntry,
  macEditorLauncher,
  nsisEditorShortcuts,
  packagingConfig,
  writeMacEditorLauncher,
} from './packaging.js';
import { RESOURCE_FOLDERS } from './paths.js';

const projectDir = resolve(import.meta.dirname, '..');
const repo = resolve(projectDir, '../..');
const config = packagingConfig({ env: {}, projectDir, arch: 'arm64', electronVersion: '44.4.5' });

describe('packagingConfig: identity', () => {
  it('is perch, with a placeholder bundle id', () => {
    expect(PRODUCT_NAME).toBe('perch');
    expect(EDITOR_PRODUCT_NAME).toBe('perch editor');
    expect(APP_ID).toBe('dev.perch.app');
    expect(config.appId).toBe(APP_ID);
    expect(config.productName).toBe(PRODUCT_NAME);
    expect(config.electronVersion).toBe('44.4.5');
  });

  it('writes into the gitignored release folder and publishes nothing', () => {
    expect(config.directories?.output).toBe('release');
    expect(config.publish).toBeNull();
    const ignored = readFileSync(join(repo, '.gitignore'), 'utf8').split('\n');
    expect(ignored).toContain('apps/desktop/release/');
  });
});

describe('packagingConfig: what is inside', () => {
  it('ships both built pages and the seed layouts where the packaged app looks for them', () => {
    const resources = config.extraResources as { from: string; to: string; filter?: string[] }[];
    const by = (to: string) => resources.find((entry) => entry.to === to);

    expect(resolve(projectDir, by(RESOURCE_FOLDERS.runtimePage)?.from ?? '')).toBe(
      join(repo, 'apps', 'runtime', 'dist', 'page'),
    );
    expect(resolve(projectDir, by(RESOURCE_FOLDERS.editorPage)?.from ?? '')).toBe(
      join(repo, 'apps', 'editor', 'dist', 'page'),
    );
    expect(by(RESOURCE_FOLDERS.runtimePage)?.filter).toEqual(['**/*', '!**/*.map']);
    expect(by(RESOURCE_FOLDERS.editorPage)?.filter).toEqual(['**/*', '!**/*.map']);
    const seed = by(RESOURCE_FOLDERS.seedLayouts);
    expect(resolve(projectDir, seed?.from ?? '')).toBe(join(repo, 'layouts'));
    // What the first-run seeding copies, and nothing it skips: no README, no invalid/.
    expect(seed?.filter).toEqual(['*.json', '*.assets/**/*']);
  });

  it('packs the compiled main process, and not the tests or the packaging code', () => {
    expect(config.files).toEqual(
      expect.arrayContaining([
        'package.json',
        'dist/**/*.js',
        'dist/**/*.cjs',
        '!dist/**/*.test.*',
        '!dist/packaging.*',
        '!dist/packaging/**',
        '!node_modules/@perch/*/{src,tsconfig.json,tsconfig.tsbuildinfo,vitest.config.ts,SPEC.md}',
      ]),
    );
  });
});

describe('packagingConfig: two launchers on each platform', () => {
  it('macOS: the dmg holds perch.app, perch editor.app beside it, and an Applications link', () => {
    const contents = config.dmg?.contents ?? [];

    expect(contents.map((item) => item.name ?? item.path)).toEqual([
      'perch.app',
      join(projectDir, 'release', 'mac-arm64', 'perch editor.app'),
      '/Applications',
    ]);
    expect(contents[2]?.type).toBe('link');
    expect(config.afterPack).toBeTypeOf('function');
    // The launcher is found where afterPack writes it, for this build's arch.
    const x64 = packagingConfig({ env: {}, projectDir, arch: 'x64', electronVersion: '44.4.5' });
    expect(x64.dmg?.contents?.[1]?.path).toBe(
      join(projectDir, 'release', 'mac', 'perch editor.app'),
    );
    expect(x64.mac?.target).toEqual([{ target: 'dmg', arch: ['x64'] }]);
  });

  it('Windows: one NSIS install with the perch shortcut and an included perch editor shortcut', () => {
    expect(config.win?.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(config.nsis?.createStartMenuShortcut).toBe(true);
    expect(config.nsis?.shortcutName).toBe(PRODUCT_NAME);
    // No folder: both shortcuts sit at the Start Menu's top level, where the include puts its one.
    expect(config.nsis?.menuCategory).toBeUndefined();
    expect(config.nsis?.include).toBe('dist/packaging/installer.nsh');
  });

  it('Linux: AppImage and deb, an editor action on perch.desktop, and a second entry in the deb', () => {
    expect(config.linux?.target).toEqual([
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ]);
    expect(config.deb?.packageName).toBe('perch');
    expect(config.linux?.executableName).toBe('perch');

    const appImage = config.appImage?.desktop;
    expect(appImage?.entry?.['Actions']).toBe('editor;');
    expect(appImage?.desktopActions?.['editor']).toMatchObject({
      Exec: `AppRun --no-sandbox ${EDITOR_SWITCH}`,
    });

    const deb = config.deb;
    expect(deb?.desktop?.entry?.['Actions']).toBe('editor;');
    expect(deb?.desktop?.desktopActions?.['editor']).toMatchObject({
      Exec: `/opt/perch/perch ${EDITOR_SWITCH}`,
    });
    expect(deb?.fpm).toEqual([
      `${join(projectDir, 'dist', 'packaging', 'perch-editor.desktop')}=/usr/share/applications/perch-editor.desktop`,
    ]);
  });
});

describe('packagingConfig: signing', () => {
  it('is off by default on every platform', () => {
    expect(config.mac?.identity).toBeNull();
    expect(config.mac?.notarize).toBe(false);
    expect(config.win?.signExecutable).toBe(false);
  });

  it('switches on from the environment', () => {
    const signed = packagingConfig({
      env: { PERCH_MAC_SIGN: '1', PERCH_MAC_NOTARIZE: '1', PERCH_WIN_SIGN: '1' },
      projectDir,
      arch: 'arm64',
      electronVersion: '44.4.5',
    });

    // Left to electron-builder, which reads CSC_NAME / CSC_LINK itself.
    expect(signed.mac).not.toHaveProperty('identity');
    expect(signed.mac?.notarize).toBe(true);
    expect(signed.win?.signExecutable).toBe(true);
    expect(signed.afterSign).toBeTypeOf('function');
  });

  it('does not notarize what it has not signed', () => {
    expect(
      packagingConfig({
        env: { PERCH_MAC_NOTARIZE: '1' },
        projectDir,
        arch: 'arm64',
        electronVersion: '44.4.5',
      }).mac?.notarize,
    ).toBe(false);
  });
});

describe('macEditorLauncher', () => {
  const launcher = macEditorLauncher({ version: '1.2.3', iconFile: 'icon.icns' });

  it('is a bundle whose executable is the script', () => {
    const plist = launcher['Contents/Info.plist'] ?? '';

    expect(plist).toContain('<key>CFBundleExecutable</key>\n  <string>perch-editor</string>');
    expect(plist).toContain(
      '<key>CFBundleIdentifier</key>\n  <string>dev.perch.app.editor</string>',
    );
    expect(plist).toContain('<key>CFBundleName</key>\n  <string>perch editor</string>');
    expect(plist).toContain('<key>CFBundleShortVersionString</key>\n  <string>1.2.3</string>');
    expect(plist).toContain('<key>CFBundleIconFile</key>\n  <string>icon.icns</string>');
    expect(plist).toContain('<key>LSUIElement</key>\n  <true/>');
    expect(Object.keys(launcher)).toContain('Contents/MacOS/perch-editor');
  });

  it('opens a new perch with the editor switch, the sibling perch.app first, else by bundle id', () => {
    const script = launcher['Contents/MacOS/perch-editor'] ?? '';

    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain(`set -- --args ${EDITOR_SWITCH} "$@"`);
    expect(script).toContain('app="$(dirname "$bundle")/perch.app"');
    expect(script).toContain('exec /usr/bin/open -n -a "$app" "$@"');
    expect(script).toContain('/usr/bin/open -n -b \'dev.perch.app\' "$@" && exit 0');
    execFileSync('/bin/sh', ['-n'], { input: script });
  });

  it('is written with an executable script and the runner app icon', () => {
    const out = mkdtempSync(join(tmpdir(), 'perch-launcher-'));
    mkdirSync(join(out, 'perch.app', 'Contents', 'Resources'), { recursive: true });
    writeFileSync(join(out, 'perch.app', 'Contents', 'Resources', 'icon.icns'), 'icns');

    const written = writeMacEditorLauncher(out, '1.2.3');

    expect(written).toBe(join(out, 'perch editor.app'));
    const script = join(written, 'Contents', 'MacOS', 'perch-editor');
    expect(statSync(script).mode & 0o777).toBe(0o755);
    expect(readFileSync(join(written, 'Contents', 'Resources', 'icon.icns'), 'utf8')).toBe('icns');
  });
});

describe('the Windows and Linux editor entries', () => {
  it('NSIS: installs and removes a perch editor shortcut that passes the editor switch', () => {
    const nsh = nsisEditorShortcuts();

    expect(nsh).toContain('!macro customInstall');
    expect(nsh).toContain(
      `CreateShortCut "$SMPROGRAMS\\perch editor.lnk" "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" "${EDITOR_SWITCH}"`,
    );
    expect(nsh).toContain('WinShell::SetLnkAUMI "$SMPROGRAMS\\perch editor.lnk" "${APP_ID}"');
    expect(nsh).toContain('!macro customUnInstall');
    expect(nsh).toContain('Delete "$SMPROGRAMS\\perch editor.lnk"');
  });

  it('deb: perch-editor.desktop runs the installed binary with the editor switch', () => {
    const entry = linuxEditorDesktopEntry();

    expect(entry.startsWith('[Desktop Entry]\n')).toBe(true);
    expect(entry).toContain('Name=perch editor\n');
    expect(entry).toContain(`Exec=/opt/perch/perch ${EDITOR_SWITCH}\n`);
    expect(entry).toContain('Icon=perch\n');
    expect(entry).toContain('StartupWMClass=perch\n');
  });
});
