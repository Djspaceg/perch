/**
 * How the desktop app is packaged: one install, two launchers, on each platform. This is the
 * config `electron-builder.config.mjs` hands electron-builder, and the few files electron-builder
 * has no option for, which it writes into `dist/packaging/` first.
 *
 * ```text
 * macOS    perch.app, the runner; perch editor.app, a script bundle that opens perch.app with
 *          --editor. Both on the .dmg, beside an Applications link.
 * Windows  one NSIS install; Start Menu shortcuts "perch" and "perch editor" (--editor)
 * Linux    AppImage and .deb; perch.desktop has an "Open editor" action, and the .deb installs a
 *          second entry, perch-editor.desktop (--editor)
 * ```
 *
 * Every editor launcher starts the one binary with `--editor`. If a perch is already running with
 * that userData, the new launch hands the editor to it through the single-instance lock
 * (`launch.ts`) and quits; if none is, it is the runner, and opens the editor over itself.
 *
 * Inside every package: the compiled main process and preloads, the relay (`@perch/agent`, a
 * production dependency, so electron-builder copies it and its own dependencies into
 * node_modules), and in the resources folder the two built pages and the seed layouts, under the
 * names `paths.ts` looks for when packaged.
 *
 * Signing is off unless the environment asks for it (`signingFromEnv`); the README has the steps.
 * Only `electron-builder.config.mjs` and a packaging run use this module: it is not in the app.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AfterPackContext, Configuration } from 'electron-builder';
import { appIconPng } from './app-icon.js';
import { EDITOR_SWITCH } from './launch.js';
import { RESOURCE_FOLDERS } from './paths.js';

type Env = Readonly<Record<string, string | undefined>>;

export const PRODUCT_NAME = 'perch';
export const EDITOR_PRODUCT_NAME = 'perch editor';
/** A placeholder, the human's to change before a release: it names the app to every OS. */
export const APP_ID = 'dev.perch.app';

const EDITOR_APP_ID = `${APP_ID}.editor`;
const EXECUTABLE = 'perch';
const LAUNCHER_EXECUTABLE = 'perch-editor';
const LAUNCHER_BUNDLE = `${EDITOR_PRODUCT_NAME}.app`;
const OUTPUT = 'release';
/** Generated here before a packaging run; also electron-builder's buildResources folder. */
const GENERATED = 'dist/packaging';
const LINUX_BINARY = `/opt/${PRODUCT_NAME}/${EXECUTABLE}`;
const LINUX_EDITOR_ENTRY = 'perch-editor.desktop';
/** A built page without its source maps, which only the dev tools of an unpackaged run read. */
const PAGE_FILES = ['**/*', '!**/*.map'];
/** What electron-builder's AppImage entry passes, for its legacy toolset: no setuid sandbox. */
const APPIMAGE_ARGS = '--no-sandbox';

export interface Signing {
  /** Sign perch.app and perch editor.app, with the identity electron-builder finds (CSC_NAME). */
  readonly mac: boolean;
  /** Notarize perch.app. Needs `mac`, and Apple credentials in the environment. */
  readonly macNotarize: boolean;
  /** Sign perch.exe and the installer, with the certificate in WIN_CSC_LINK. */
  readonly win: boolean;
}

/**
 * Off unless `PERCH_MAC_SIGN=1`, `PERCH_MAC_NOTARIZE=1`, `PERCH_WIN_SIGN=1`. Explicit, because
 * electron-builder signs on its own when it finds a Developer ID in the keychain.
 */
export function signingFromEnv(env: Env): Signing {
  const mac = env['PERCH_MAC_SIGN'] === '1';
  return {
    mac,
    macNotarize: mac && env['PERCH_MAC_NOTARIZE'] === '1',
    win: env['PERCH_WIN_SIGN'] === '1',
  };
}

export interface PackagingOptions {
  readonly env: Env;
  /** apps/desktop. */
  readonly projectDir: string;
  /** The architecture to build for macOS, `process.arch` in a packaging run. */
  readonly arch: string;
  /** The installed Electron's version: package.json has a range, electron-builder needs one. */
  readonly electronVersion: string;
}

export function packagingConfig(options: PackagingOptions): Configuration {
  const { projectDir } = options;
  const signing = signingFromEnv(options.env);
  const macArch = options.arch === 'arm64' ? 'arm64' : 'x64';
  // Where electron-builder puts the .app for that arch, and so where afterPack writes the launcher.
  const macOut = join(projectDir, OUTPUT, macArch === 'arm64' ? 'mac-arm64' : 'mac');
  const editorAction = (exec: string) => ({
    entry: { Actions: 'editor;' },
    desktopActions: { editor: { Name: 'Open editor', Exec: exec } },
  });

  return {
    appId: APP_ID,
    productName: PRODUCT_NAME,
    electronVersion: options.electronVersion,
    // The description is what a Linux menu, a .deb and a Windows shortcut show. Electron names the
    // Linux app_id from desktopName, and both .desktop entries' StartupWMClass match it. A .deb
    // must name a homepage: the repository's.
    extraMetadata: {
      description: 'Hardware telemetry dashboards',
      desktopName: `${PRODUCT_NAME}.desktop`,
      homepage: 'https://github.com/Djspaceg/perch',
    },
    directories: { output: OUTPUT, buildResources: GENERATED },
    files: [
      'package.json',
      'dist/**/*.js',
      'dist/**/*.cjs',
      '!dist/**/*.test.*',
      '!dist/packaging.*',
      '!dist/packaging/**',
      '!dist/app-icon.*',
      // The workspace packages are copied as folders, whatever their `files` say: their built
      // `dist` only. And no type declarations or source maps from anywhere.
      '!node_modules/@perch/*/{src,tsconfig.json,tsconfig.tsbuildinfo,vitest.config.ts,SPEC.md}',
      '!node_modules/@types{,/**}',
      '!**/*.map',
    ],
    extraResources: [
      { from: '../runtime/dist/page', to: RESOURCE_FOLDERS.runtimePage, filter: PAGE_FILES },
      { from: '../editor/dist/page', to: RESOURCE_FOLDERS.editorPage, filter: PAGE_FILES },
      // What `prepareLayoutsFolder` seeds from; the README and invalid/ are not seeded.
      {
        from: '../../layouts',
        to: RESOURCE_FOLDERS.seedLayouts,
        filter: ['*.json', '*.assets/**/*'],
      },
    ],
    // No native modules: the relay is plain JavaScript.
    npmRebuild: false,
    publish: null,

    mac: {
      target: [{ target: 'dmg', arch: [macArch] }],
      category: 'public.app-category.utilities',
      ...(signing.mac ? {} : { identity: null }),
      notarize: signing.macNotarize,
    },
    // On electron-builder's 540x380 background, whose arrow is at its centre: both apps to the
    // left of it, stacked, Applications to the right.
    dmg: {
      contents: [
        { x: 130, y: 150, type: 'file', name: `${PRODUCT_NAME}.app` },
        { x: 130, y: 290, type: 'file', path: join(macOut, LAUNCHER_BUNDLE) },
        { x: 410, y: 222, type: 'link', path: '/Applications' },
      ],
    },
    afterPack: (context: AfterPackContext) => {
      if (context.electronPlatformName === 'darwin') {
        writeMacEditorLauncher(context.appOutDir, context.packager.appInfo.version);
      }
    },
    ...(signing.mac
      ? {
          afterSign: (context: AfterPackContext) => {
            if (context.electronPlatformName === 'darwin') {
              signMacEditorLauncher(join(context.appOutDir, LAUNCHER_BUNDLE), options.env);
            }
          },
        }
      : {}),

    win: {
      target: [{ target: 'nsis', arch: ['x64'] }],
      signExecutable: signing.win,
    },
    nsis: {
      shortcutName: PRODUCT_NAME,
      createStartMenuShortcut: true,
      include: `${GENERATED}/installer.nsh`,
    },

    linux: {
      target: [
        { target: 'AppImage', arch: ['x64'] },
        { target: 'deb', arch: ['x64'] },
      ],
      executableName: EXECUTABLE,
      category: 'Utility',
      // A placeholder, the human's to change: a .deb must name a maintainer.
      maintainer: 'perch <perch@example.invalid>',
    },
    appImage: {
      desktop: editorAction(`AppRun ${APPIMAGE_ARGS} ${EDITOR_SWITCH}`),
    },
    deb: {
      // Not the npm name, which is scoped and not a legal Debian package name.
      packageName: PRODUCT_NAME,
      artifactName: '${productName}_${version}_${arch}.${ext}',
      desktop: editorAction(`${LINUX_BINARY} ${EDITOR_SWITCH}`),
      fpm: [
        `${join(projectDir, GENERATED, LINUX_EDITOR_ENTRY)}=/usr/share/applications/${LINUX_EDITOR_ENTRY}`,
      ],
    },
  };
}

/** Write what electron-builder reads from `dist/packaging/`: the icon and the two editor entries. */
export function writePackagingResources(projectDir: string): void {
  const folder = join(projectDir, GENERATED);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'icon.png'), appIconPng(1024));
  writeFileSync(join(folder, 'installer.nsh'), nsisEditorShortcuts());
  writeFileSync(join(folder, LINUX_EDITOR_ENTRY), linuxEditorDesktopEntry());
}

/**
 * perch editor.app's files, by path inside the bundle. Its executable is a shell script: it opens
 * a new perch (`open -n`, so macOS starts a process rather than just activating a running perch),
 * with `--editor` and whatever it was given, and any PERCH_* variables it was started with.
 */
export function macEditorLauncher(options: {
  readonly version: string;
  readonly iconFile: string;
}): Record<string, string> {
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...plistEntries({
      CFBundleExecutable: LAUNCHER_EXECUTABLE,
      CFBundleIdentifier: EDITOR_APP_ID,
      CFBundleName: EDITOR_PRODUCT_NAME,
      CFBundleDisplayName: EDITOR_PRODUCT_NAME,
      CFBundlePackageType: 'APPL',
      CFBundleInfoDictionaryVersion: '6.0',
      CFBundleShortVersionString: options.version,
      CFBundleVersion: options.version,
      CFBundleIconFile: options.iconFile,
      LSApplicationCategoryType: 'public.app-category.utilities',
    }),
    // No dock icon of its own: it runs for a moment, and perch shows its own.
    '  <key>LSUIElement</key>',
    '  <true/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

  const script = `#!/bin/sh
# ${EDITOR_PRODUCT_NAME}: opens ${PRODUCT_NAME} with its editor. Written by apps/desktop/src/packaging.ts.
# A new ${PRODUCT_NAME} hands the editor to one already running and quits (the single-instance lock).
bundle=$(cd "$(dirname "$0")/../.." && pwd)
app="$(dirname "$bundle")/${PRODUCT_NAME}.app"
set -- --args ${EDITOR_SWITCH} "$@"
for name in $(env | sed -n 's/^\\(PERCH_[A-Za-z0-9_]*\\)=.*/\\1/p'); do
  eval "value=\\$$name"
  set -- --env "$name=$value" "$@"
done
if [ -d "$app" ]; then
  exec /usr/bin/open -n -a "$app" "$@"
fi
/usr/bin/open -n -b '${APP_ID}' "$@" && exit 0
/usr/bin/osascript -e 'display alert "${EDITOR_PRODUCT_NAME} could not find ${PRODUCT_NAME}.app" message "Put it in the same folder as ${EDITOR_PRODUCT_NAME}."' >/dev/null
exit 1
`;

  return {
    'Contents/Info.plist': plist,
    'Contents/PkgInfo': 'APPL????',
    [`Contents/MacOS/${LAUNCHER_EXECUTABLE}`]: script,
  };
}

/** Write perch editor.app beside the packed perch.app in `appOutDir`, with perch.app's icon. */
export function writeMacEditorLauncher(appOutDir: string, version: string): string {
  const bundle = join(appOutDir, LAUNCHER_BUNDLE);
  rmSync(bundle, { recursive: true, force: true });
  for (const [path, text] of Object.entries(
    macEditorLauncher({ version, iconFile: 'icon.icns' }),
  )) {
    const target = join(bundle, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  chmodSync(join(bundle, 'Contents', 'MacOS', LAUNCHER_EXECUTABLE), 0o755);

  const icon = join(appOutDir, `${PRODUCT_NAME}.app`, 'Contents', 'Resources', 'icon.icns');
  if (existsSync(icon)) {
    mkdirSync(join(bundle, 'Contents', 'Resources'), { recursive: true });
    copyFileSync(icon, join(bundle, 'Contents', 'Resources', 'icon.icns'));
  }
  return bundle;
}

/**
 * Sign perch editor.app with the identity perch.app was signed with. electron-builder signs only
 * the app it built; this bundle is ours. The identity is CSC_NAME's, named explicitly.
 */
function signMacEditorLauncher(bundle: string, env: Env): void {
  const identity = env['CSC_NAME']?.trim();
  if (identity === undefined || identity === '') {
    throw new Error(
      'PERCH_MAC_SIGN=1 needs CSC_NAME, the Developer ID Application identity, to sign ' +
        LAUNCHER_BUNDLE,
    );
  }
  execFileSync(
    'codesign',
    ['--force', '--timestamp', '--options', 'runtime', '--sign', identity, bundle],
    { stdio: 'inherit' },
  );
}

/** The NSIS include: a perch editor shortcut beside electron-builder's perch one, and its removal. */
export function nsisEditorShortcuts(): string {
  const link = `"$SMPROGRAMS\\${EDITOR_PRODUCT_NAME}.lnk"`;
  const exe = '"$INSTDIR\\${APP_EXECUTABLE_FILENAME}"';
  return [
    "; Written by apps/desktop/src/packaging.ts. The perch shortcut is electron-builder's own.",
    '!macro customInstall',
    `  CreateShortCut ${link} ${exe} "${EDITOR_SWITCH}" ${exe} 0 "" "" "Edit perch layouts"`,
    `  WinShell::SetLnkAUMI ${link} "\${APP_ID}"`,
    '!macroend',
    '',
    '!macro customUnInstall',
    `  WinShell::UninstShortcut ${link}`,
    `  Delete ${link}`,
    '!macroend',
    '',
  ].join('\r\n');
}

/** The .deb's second desktop entry. */
export function linuxEditorDesktopEntry(): string {
  return [
    '[Desktop Entry]',
    `Name=${EDITOR_PRODUCT_NAME}`,
    'Comment=Edit perch layouts',
    `Exec=${LINUX_BINARY} ${EDITOR_SWITCH}`,
    'Terminal=false',
    'Type=Application',
    `Icon=${EXECUTABLE}`,
    `StartupWMClass=${PRODUCT_NAME}`,
    'Categories=Utility;',
    '',
  ].join('\n');
}

function plistEntries(entries: Record<string, string>): string[] {
  return Object.entries(entries).flatMap(([key, value]) => [
    `  <key>${key}</key>`,
    `  <string>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`,
  ]);
}
