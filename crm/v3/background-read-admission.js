import { clearOperatorPropertyImageCache, fetchOperatorPropertyImage } from '../v3-app/src/property-image.js';
import { fetchQuoteWalkV2OperatorReceipt } from '../v3-app/src/quote-walk-v2-receipts.js';

const abortError = () => new DOMException('Background read cancelled', 'AbortError');

// Contacts render first. Keep decorative reads out of the browser transport
// queue until the required secondary domains have settled, then admit only two.
export function createBackgroundReadAdmission({ concurrency = 2, onReset = () => {} } = {}) {
  let held = true;
  let generation = 0;
  let holdVersion = 0;
  const pending = [];
  const active = new Set();

  function rejectWaiter(item) {
    if (item.settled) return;
    item.settled = true;
    item.reject(abortError());
  }

  function pump() {
    // An old session's physical reads must finish or abort before a new
    // session can consume their shared image cache or inflight promises.
    if (held || [...active].some(item => item.generation !== generation)) return;
    while (active.size < concurrency && pending.length) {
      const item = pending.shift();
      item.signal?.removeEventListener('abort', item.abort);
      if (item.settled || item.generation !== generation) continue;
      active.add(item);
      Promise.resolve().then(() => {
        if (item.settled || item.generation !== generation || item.controller.signal.aborted) throw abortError();
        return item.task(item.controller.signal);
      }).then(value => {
        if (item.settled || item.generation !== generation) item.onDiscard?.(value);
        else { item.settled = true; item.resolve(value); }
      }, error => {
        if (!item.settled) { item.settled = true; item.reject(error); }
      }).finally(() => {
        if (item.generation !== generation) onReset();
        item.signal?.removeEventListener('abort', item.abort);
        active.delete(item);
        pump();
      });
      // A consumer may leave while its shared image request is active. Reject
      // that consumer but retain the physical slot until its real work ends.
      item.signal?.addEventListener('abort', item.abort, { once: true });
    }
  }

  return {
    holdEssentialReads() {
      held = true;
      const version = ++holdVersion;
      const current = generation;
      return () => {
        if (current !== generation || version !== holdVersion) return;
        held = false;
        pump();
      };
    },
    schedule(task, { signal, onDiscard } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      return new Promise((resolve, reject) => {
        const item = { task, signal, onDiscard, resolve, reject, generation,
          controller: new AbortController(), settled: false };
        item.abort = () => {
          rejectWaiter(item);
          const index = pending.indexOf(item);
          if (index !== -1) pending.splice(index, 1);
          signal?.removeEventListener('abort', item.abort);
        };
        signal?.addEventListener('abort', item.abort, { once: true });
        pending.push(item);
        pump();
      });
    },
    reset() {
      held = true;
      generation += 1;
      for (const item of pending.splice(0)) {
        item.signal?.removeEventListener('abort', item.abort);
        rejectWaiter(item);
      }
      for (const item of active) {
        rejectWaiter(item);
        item.controller.abort();
      }
      onReset();
    },
  };
}

export const browserBackgroundReads = createBackgroundReadAdmission({ onReset: clearOperatorPropertyImageCache });

export function fetchBrowserPropertyImage({ signal, ...options }) {
  const transport = options.fetchImpl || globalThis.fetch;
  return browserBackgroundReads.schedule(lifecycleSignal => fetchOperatorPropertyImage({
    ...options,
    // Consumer cancellation must not release a physical slot or cancel a
    // coalesced peer. Session reset cancels the underlying transport instead.
    fetchImpl: (url, init) => transport(url, { ...init, signal: lifecycleSignal }),
  }), {
    signal,
    onDiscard: result => { if (result?.url) globalThis.URL.revokeObjectURL(result.url); },
  });
}

export async function fetchBrowserReceiptMap(db, preReadsByContact) {
  const entries = await Promise.all(Object.entries(preReadsByContact || {}).map(async ([contactId, preRead]) => {
    const receipt = await browserBackgroundReads.schedule(() =>
      fetchQuoteWalkV2OperatorReceipt(db, preRead?.id, contactId));
    return [contactId, receipt];
  }));
  return Object.fromEntries(entries);
}
