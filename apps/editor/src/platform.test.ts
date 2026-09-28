/**
 * Which platform the editor is on. How a shortcut is written for it is `keybindings/binding.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { detectPlatform } from './platform.js';

describe('detectPlatform', () => {
  it('reads userAgentData first', () => {
    expect(detectPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac');
    expect(detectPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe(
      'other',
    );
    expect(detectPlatform({ userAgentData: { platform: 'Linux' } })).toBe('other');
  });

  it('falls back to navigator.platform, counting iPhone and iPad as Mac', () => {
    for (const platform of ['MacIntel', 'iPhone', 'iPad']) {
      expect(detectPlatform({ userAgentData: { platform: '' }, platform }), platform).toBe('mac');
    }
    for (const platform of ['Win32', 'Linux x86_64']) {
      expect(detectPlatform({ platform }), platform).toBe('other');
    }
  });

  it('falls back to the userAgent when both are empty', () => {
    expect(
      detectPlatform({
        platform: '',
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      }),
    ).toBe('mac');
    expect(
      detectPlatform({ platform: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }),
    ).toBe('other');
    expect(detectPlatform({})).toBe('other');
    expect(detectPlatform(undefined)).toBe('other');
  });
});
