export function computeProgress({ done, total, elapsedMs }) {
  const finished = total > 0 && done >= total;
  const fraction = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const hasRate = done > 0 && elapsedMs > 0;
  return {
    fraction,
    percent: Math.floor(fraction * 100),
    ratePerSecond: hasRate ? done / (elapsedMs / 1000) : 0,
    etaMs: finished ? 0 : hasRate ? (elapsedMs / done) * (total - done) : null,
  };
}
