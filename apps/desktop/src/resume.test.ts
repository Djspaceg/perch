import { describe, expect, it } from 'vitest';
import { chooseDocument } from './resume.js';

const folder = '/home/u/Documents/perch/layouts';
const desk = { name: 'desk', path: `${folder}/desk.json` };
const tower = { name: 'tower', path: `${folder}/tower.json` };

describe('chooseDocument', () => {
  it('reopens the last document when it is still there', () => {
    expect(
      chooseDocument({ saved: tower.path, savedExists: true, listing: [desk, tower], folder }),
    ).toEqual({
      document: tower,
      notice: null,
    });
  });

  it('reopens a last document that lives outside the folder, if it still exists', () => {
    const elsewhere = '/tmp/scratch/panel.json';

    expect(
      chooseDocument({ saved: elsewhere, savedExists: true, listing: [desk], folder }),
    ).toEqual({
      document: { name: 'panel', path: elsewhere },
      notice: null,
    });
  });

  it('falls back to the first document when the last one is gone, and says so', () => {
    const choice = chooseDocument({
      saved: `${folder}/deleted.json`,
      savedExists: false,
      listing: [desk, tower],
      folder,
    });

    expect(choice.document).toEqual(desk);
    expect(choice.notice).toContain('deleted.json');
    expect(choice.notice).toContain('desk');
  });

  it('opens the first document on a first run, with nothing to say', () => {
    expect(
      chooseDocument({ saved: null, savedExists: false, listing: [desk, tower], folder }),
    ).toEqual({
      document: desk,
      notice: null,
    });
  });

  it('opens nothing when the folder is empty, and names the folder', () => {
    const choice = chooseDocument({ saved: null, savedExists: false, listing: [], folder });

    expect(choice.document).toBeNull();
    expect(choice.notice).toContain(folder);
  });
});
