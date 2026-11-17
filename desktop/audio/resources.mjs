import { AudioDeviceError } from './errors.mjs';

export function stopStream(stream) {
  for (const track of stream?.getTracks() || []) track.stop();
}

// Native permission prompts cannot be dismissed from JS. A late stream is stopped,
// including after timeout, navigation, suspend or cancellation.
export function bounded(promise, { milliseconds = 12000, signal, late = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return false;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      fn(value);
      return true;
    };
    const abort = () => finish(reject, new AudioDeviceError('CANCELLED'));
    const timer = setTimeout(() => finish(reject, new AudioDeviceError('TIMEOUT')), milliseconds);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => {
      if (!finish(resolve, value)) late(value);
    }, error => finish(reject, error));
  });
}

export function releaseGraph(graph) {
  if (!graph || graph.released) return;
  graph.released = true;
  clearInterval(graph.interval);
  clearTimeout(graph.timer);
  graph.unwatch?.();
  graph.unwatchTracks?.();
  try { graph.element?.pause(); } catch { /* already detached */ }
  if (graph.element) graph.element.srcObject = null;
  try { graph.oscillator?.stop(); } catch { /* already stopped */ }
  for (const node of graph.nodes || []) {
    try { node.disconnect(); } catch { /* already disconnected */ }
  }
  stopStream(graph.raw);
  stopStream(graph.stream);
  if (graph.context && graph.context.state !== 'closed') {
    // Closing starts synchronously; observe rejection without delaying shutdown.
    void graph.context.close().catch(() => {});
  }
}
