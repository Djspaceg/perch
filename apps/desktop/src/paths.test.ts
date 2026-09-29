import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RESOURCE_FOLDERS,
  appResources,
  editorPageFolder,
  layoutsFolder,
  runtimePageFolder,
  seedLayoutsFolder,
  userDataOverride,
} from './paths.js';

describe('paths', () => {
  it('puts the layouts folder under Documents unless PERCH_LAYOUTS_DIR moves it', () => {
    expect(layoutsFolder({}, '/Users/u/Documents')).toBe('/Users/u/Documents/perch/layouts');
    expect(layoutsFolder({ PERCH_LAYOUTS_DIR: '/tmp/l' }, '/Users/u/Documents')).toBe('/tmp/l');
    expect(layoutsFolder({ PERCH_LAYOUTS_DIR: '  ' }, '/Users/u/Documents')).toBe(
      '/Users/u/Documents/perch/layouts',
    );
  });

  it('leaves userData to Electron unless PERCH_USER_DATA_DIR is set', () => {
    expect(userDataOverride({})).toBeNull();
    expect(userDataOverride({ PERCH_USER_DATA_DIR: 'relative/dir' })).toBe(resolve('relative/dir'));
  });

  it('takes --user-data-dir from the command line ahead of PERCH_USER_DATA_DIR', () => {
    const env = { PERCH_USER_DATA_DIR: '/tmp/from-env' };

    expect(userDataOverride(env, ['electron', '.', '--user-data-dir=/tmp/from-argv'])).toBe(
      '/tmp/from-argv',
    );
    expect(userDataOverride({}, ['electron', '--user-data-dir', '/tmp/spaced', '.'])).toBe(
      '/tmp/spaced',
    );
    expect(userDataOverride(env, ['electron', '.', '--user-data-dir='])).toBe('/tmp/from-env');
    expect(userDataOverride({}, ['electron', '.'])).toBeNull();
  });

  it('finds the built runtime page and the seed in this repository', () => {
    const repo = resolve(import.meta.dirname, '../../..');

    expect(runtimePageFolder({}, null)).toBe(join(repo, 'apps', 'runtime', 'dist', 'page'));
    expect(runtimePageFolder({ PERCH_RUNTIME_PAGE_DIR: '/opt/page' }, null)).toBe('/opt/page');
    expect(seedLayoutsFolder(null)).toBe(join(repo, 'layouts'));
    expect(editorPageFolder({}, null)).toBe(join(repo, 'apps', 'editor', 'dist', 'page'));
    expect(editorPageFolder({ PERCH_EDITOR_PAGE_DIR: '/opt/editor' }, null)).toBe('/opt/editor');
  });

  it('finds them in the resources folder of a packaged app, never in the repository', () => {
    const resources = '/Applications/perch.app/Contents/Resources';

    expect(RESOURCE_FOLDERS).toEqual({
      runtimePage: 'runtime-page',
      editorPage: 'editor-page',
      seedLayouts: 'layouts',
    });
    expect(runtimePageFolder({}, resources)).toBe(join(resources, 'runtime-page'));
    expect(editorPageFolder({}, resources)).toBe(join(resources, 'editor-page'));
    expect(seedLayoutsFolder(resources)).toBe(join(resources, 'layouts'));
    // The variables still move the pages, packaged or not.
    expect(runtimePageFolder({ PERCH_RUNTIME_PAGE_DIR: '/opt/page' }, resources)).toBe('/opt/page');
  });

  it('is told it is packaged by Electron, and then reads process.resourcesPath', () => {
    expect(appResources({ isPackaged: false, resourcesPath: '/x/Resources' })).toBeNull();
    expect(appResources({ isPackaged: true, resourcesPath: '/x/Resources' })).toBe('/x/Resources');
  });
});
