import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutsFolder, runtimePageFolder, seedLayoutsFolder, userDataOverride } from './paths.js';

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

  it('finds the built runtime page and the seed in this repository', () => {
    const repo = resolve(import.meta.dirname, '../../..');

    expect(runtimePageFolder({})).toBe(join(repo, 'apps', 'runtime', 'dist', 'page'));
    expect(runtimePageFolder({ PERCH_RUNTIME_PAGE_DIR: '/opt/page' })).toBe('/opt/page');
    expect(seedLayoutsFolder()).toBe(join(repo, 'layouts'));
  });
});
