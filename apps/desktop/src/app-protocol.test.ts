import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_SCHEME,
  EDITOR_PAGE_URL,
  RUNTIME_PAGE_URL,
  contentSecurityPolicy,
  editorAssetUrl,
  editorContentSecurityPolicy,
  isAppPage,
  isEditorPage,
  isRuntimePage,
  resolveAppRequest,
} from './app-protocol.js';

const roots = {
  runtime: '/opt/perch/runtime-page',
  document: '/home/u/layouts',
  editor: '/opt/perch/editor-page',
  editorDocument: (key: string) => (key === 'desk' ? '/home/u/layouts' : null),
};

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
    expect(resolveAppRequest('app://elsewhere/index.html', roots)).toBeNull();
    expect(resolveAppRequest('file:///etc/passwd', roots)).toBeNull();
    expect(resolveAppRequest('app://document/a.svg', { ...roots, document: null })).toBeNull();
  });
});

describe('the editor hosts', () => {
  it('serves the built editor page', () => {
    expect(EDITOR_PAGE_URL).toBe(`${APP_SCHEME}://editor/index.html`);
    expect(resolveAppRequest('app://editor/', roots)).toBe(join(roots.editor, 'index.html'));
    expect(resolveAppRequest('app://editor/assets/index-1.js', roots)).toBe(
      join(roots.editor, 'assets', 'index-1.js'),
    );
  });

  it("serves an editor document's media from that document's own folder, by its key", () => {
    const url = editorAssetUrl('desk', 'desk.assets/grid lines.svg');

    expect(url).toBe('app://editor-document/desk/desk.assets/grid%20lines.svg');
    expect(resolveAppRequest(url, roots)).toBe(
      join('/home/u/layouts', 'desk.assets', 'grid lines.svg'),
    );
  });

  it('refuses an unknown key, a bare key, and anything that would leave the folder', () => {
    for (const url of [
      'app://editor-document/tower/a.svg',
      'app://editor-document/desk',
      'app://editor-document/desk/',
      'app://editor-document/desk/../secret.json',
      'app://editor-document/desk/%2e%2e/secret.json',
      'app://editor-document/%2e%2e/desk/a.svg',
      'app://editor/../runtime/index.html',
    ]) {
      expect(resolveAppRequest(url, roots), url).toBeNull();
    }
  });

  it('knows each page apart, and the navigation lock allows exactly the two', () => {
    expect(isEditorPage('app://editor/index.html')).toBe(true);
    expect(isEditorPage('app://editor/')).toBe(true);
    expect(isEditorPage('app://runtime/index.html')).toBe(false);
    expect(isRuntimePage('app://editor/index.html')).toBe(false);
    expect(isAppPage('app://editor/index.html')).toBe(true);
    expect(isAppPage('app://runtime/index.html')).toBe(true);
    expect(isAppPage('app://editor-document/desk/a.svg')).toBe(false);
    expect(isAppPage('https://example.com/')).toBe(false);
  });

  it("gives the editor its own documents' media, and still only the relay to dial", () => {
    const policy = editorContentSecurityPolicy('ws://127.0.0.1:19001');

    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain('img-src app://editor-document');
    expect(policy).not.toContain('app://document');
    expect(policy).toContain('connect-src ws://127.0.0.1:19001');
    expect(policy).not.toContain('unsafe-eval');
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
