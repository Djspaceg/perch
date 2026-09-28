import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
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

    expect(runtimePageFolder({})).toBe(join(repo, 'apps', 'runtime', 'dist', 'page'));
    expect(runtimePageFolder({ PERCH_RUNTIME_PAGE_DIR: '/opt/page' })).toBe('/opt/page');
    expect(seedLayoutsFolder()).toBe(join(repo, 'layouts'));
    expect(editorPageFolder({})).toBe(join(repo, 'apps', 'editor', 'dist', 'page'));
    expect(editorPageFolder({ PERCH_EDITOR_PAGE_DIR: '/opt/editor' })).toBe('/opt/editor');
  });
});
