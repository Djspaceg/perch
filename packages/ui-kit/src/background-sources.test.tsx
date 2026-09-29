/**
 * `useBackgroundSources`: each background a layout names, asked for once per target, and its state
 * as the canvas reads it. The asking is injected; this holds no network code.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Layout } from '@perch/layout-schema';
import {
  NO_BACKGROUND_HOST,
  useBackgroundSources,
  type BackgroundSource,
  type EnsureBackground,
} from '@perch/ui-kit';

const layoutWith = (srcs: readonly string[], width = 1920, height = 400): Layout => ({
  schemaVersion: 2,
  target: { width, height, frameRate: 30 },
  theme: {},
  elements: srcs.map((src) => ({ kind: 'media', src, rect: { x: 0, y: 0, w: width, h: height } })),
});

function deferred(): {
  promise: Promise<BackgroundSource>;
  resolve: (value: BackgroundSource) => void;
} {
  let resolve: (value: BackgroundSource) => void = () => undefined;
  const promise = new Promise<BackgroundSource>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useBackgroundSources', () => {
  it('asks for each reference the layout names, once, with its target, and reports loading then ready', async () => {
    const answer = deferred();
    const ensure = vi.fn<EnsureBackground>(() => answer.promise);
    const layout = layoutWith(['thermalright:a042', 'backdrop.png', 'thermalright:a042']);
    const { result } = renderHook(() => useBackgroundSources(layout, ensure));

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith('thermalright:a042', { width: 1920, height: 400 });
    expect(result.current('thermalright:a042')).toEqual({ status: 'loading' });

    await act(async () => {
      answer.resolve({ status: 'ready', url: 'perch-cache://backgrounds/x.mp4' });
      await answer.promise;
    });
    expect(result.current('thermalright:a042')).toEqual({
      status: 'ready',
      url: 'perch-cache://backgrounds/x.mp4',
    });
  });

  it('asks again when the target changes, since the size picked may too', () => {
    const ensure = vi.fn<EnsureBackground>(() => new Promise<BackgroundSource>(() => undefined));
    const { rerender } = renderHook(({ layout }) => useBackgroundSources(layout, ensure), {
      initialProps: { layout: layoutWith(['thermalright:a042']) },
    });
    rerender({ layout: layoutWith(['thermalright:a042']) });
    expect(ensure).toHaveBeenCalledTimes(1);

    rerender({ layout: layoutWith(['thermalright:a042'], 480, 480) });
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(ensure).toHaveBeenLastCalledWith('thermalright:a042', { width: 480, height: 480 });
  });

  it('reports a rejected ask as a failure with its message', async () => {
    const ensure: EnsureBackground = () => Promise.reject(new Error('the bridge is gone'));
    const { result } = renderHook(() =>
      useBackgroundSources(layoutWith(['thermalright:a042']), ensure),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current('thermalright:a042')).toEqual({
      status: 'failed',
      reason: 'the bridge is gone',
    });
  });

  it('says why with no host to ask, and asks nothing for a layout with no reference', () => {
    const { result } = renderHook(() =>
      useBackgroundSources(layoutWith(['thermalright:a042']), undefined),
    );
    expect(result.current('thermalright:a042')).toEqual({
      status: 'failed',
      reason: NO_BACKGROUND_HOST,
    });

    const ensure = vi.fn<EnsureBackground>();
    renderHook(() => useBackgroundSources(layoutWith(['backdrop.png']), ensure));
    renderHook(() => useBackgroundSources(null, ensure));
    expect(ensure).not.toHaveBeenCalled();
  });
});
