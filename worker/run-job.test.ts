import { describe, expect, it, vi } from 'vitest';
import { runJob, type JobStore } from './run-job';

function fakeStore() {
  const calls: Array<{ type: 'start' | 'finish'; args: unknown[] }> = [];
  const store: JobStore = {
    start: vi.fn(async (name: string) => {
      calls.push({ type: 'start', args: [name] });
      return 'run-1';
    }),
    finish: vi.fn(async (...args) => void calls.push({ type: 'finish', args })),
  };
  return { store, calls };
}

describe('runJob', () => {
  it('records a successful run with its item count and meta', async () => {
    const { store } = fakeStore();
    const result = await runJob(store, 'demo', async () => ({ itemsProcessed: 7, meta: { a: 1 } }));

    expect(result.itemsProcessed).toBe(7);
    expect(store.start).toHaveBeenCalledWith('demo');
    expect(store.finish).toHaveBeenCalledWith('run-1', {
      status: 'success',
      itemsProcessed: 7,
      error: null,
      meta: { a: 1 },
    });
  });

  it('defaults meta to an empty object', async () => {
    const { store } = fakeStore();
    await runJob(store, 'demo', async () => ({ itemsProcessed: 0 }));
    expect(store.finish).toHaveBeenCalledWith('run-1', expect.objectContaining({ meta: {} }));
  });

  it('records a failure and rethrows it', async () => {
    const { store } = fakeStore();
    await expect(
      runJob(store, 'demo', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(store.finish).toHaveBeenCalledWith('run-1', {
      status: 'failed',
      itemsProcessed: 0,
      error: 'boom',
      meta: {},
    });
  });

  it('records non-Error failures and truncates very long messages', async () => {
    const { store } = fakeStore();
    await expect(
      runJob(store, 'demo', async () => {
        throw 'x'.repeat(5000);
      }),
    ).rejects.toBe('x'.repeat(5000));
    const patch = (store.finish as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(patch.error).toHaveLength(2000);
  });
});
