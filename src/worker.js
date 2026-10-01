import { enumeratePatterns } from './patterns.js';

self.onmessage = ({ data }) => {
  try {
    const start = performance.now();
    const result = enumeratePatterns(data);
    self.postMessage({ ...result, elapsed: performance.now() - start }, [result.patterns.buffer, result.counts.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
