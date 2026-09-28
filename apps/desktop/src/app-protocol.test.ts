import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_SCHEME,
  RUNTIME_PAGE_URL,
  contentSecurityPolicy,
  isRuntimePage,
  resolveAppRequest,
} from './app-protocol.js';

const roots = { runtime: '/opt/perch/runtime-page', document: '/home/u/layouts' };

describe('resolveAppRequest', () => {
  it('serves the runtime page, defaulting a directory to index.html', () => {
    expect(RUNTIME_PAGE_URL).toBe(`${APP_SCHEME}://runtime/index.html`);
    expect(resolveAppRequest('app://runtime/', roots)).toBe(join(roots.runtime, 'index.html'));
    expect(resolveAppRequest('app://runtime/assets/index-abc.js', roots)).toBe(
      join(roots.runtime, 'assets', 'index-abc.js'),
    );
  });

  it("serves media relative to the open document's folder, decoding the path", () => {
    expect(resolveAppRequest('app://document/desk.assets/grid%20lines.png', roots)).toBe(
      join(roots.document, 'desk.assets', 'grid lines.png'),
    );
  });

  it('refuses anything that would leave its root', () => {
    for (const url of [
      'app://runtime/../secret',
      'app://runtime/%2e%2e/secret',
      'app://document/..%2f..%2fetc/passwd',
      'app://document/%2Fetc%2Fpasswd',
    ]) {
      expect(resolveAppRequest(url, roots), url).toBeNull();
    }
  });

  it('refuses unknown hosts, other schemes, and the document host while nothing is open', () => {
    expect(resolveAppRequest('app://editor/index.html', roots)).toBeNull();
    expect(resolveAppRequest('file:///etc/passwd', roots)).toBeNull();
    expect(resolveAppRequest('app://document/a.svg', { ...roots, document: null })).toBeNull();
  });
});

describe('isRuntimePage', () => {
  it('allows only the runtime page itself', () => {
    expect(isRuntimePage('app://runtime/index.html')).toBe(true);
    expect(isRuntimePage('app://runtime/index.html?layout=x')).toBe(true);
    expect(isRuntimePage('app://document/desk.assets/rails.svg')).toBe(false);
    expect(isRuntimePage('https://example.com/')).toBe(false);
    expect(isRuntimePage('file:///Users/u/index.html')).toBe(false);
    expect(isRuntimePage('not a url')).toBe(false);
  });
});

describe('contentSecurityPolicy', () => {
  it('lets the page run its own scripts, show document media, and dial only the relay', () => {
    const policy = contentSecurityPolicy('ws://127.0.0.1:19001');

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain('img-src app://document');
    expect(policy).toContain('connect-src ws://127.0.0.1:19001');
    expect(policy).not.toContain('unsafe-eval');
  });
});
