/** Round tick values (steps of 1, 2, 5 x 10^n) covering [min, max], so axes read in clean numbers. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min];
  const magnitude = Math.floor(Math.log10((max - min) / target));
  const ticksFor = (step: number) => {
    const out: number[] = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6 + 0); // + 0 turns -0 into 0
    return out;
  };
  // Of the round steps near the ideal one, take the one whose tick count is closest to the target
  // (the larger step on a tie), so a range never ends up with two ticks or twelve.
  let best: number[] = [];
  let bestScore = Infinity;
  for (const k of [magnitude - 1, magnitude, magnitude + 1]) {
    for (const m of [1, 2, 5]) {
      const ticks = ticksFor(m * 10 ** k);
      const score = Math.abs(ticks.length - target) + (ticks.length >= 2 ? 0 : 100);
      if (score <= bestScore) {
        best = ticks;
        bestScore = score;
      }
    }
  }
  return best;
}

/** A bar from `yBase` to `yEnd` with a rounded data end and a square baseline end (SVG path). */
export function barPath(x: number, width: number, yBase: number, yEnd: number, radius = 4): string {
  const h = Math.abs(yEnd - yBase);
  if (h < 0.5) return '';
  const r = Math.min(radius, width / 2, h);
  const x2 = x + width;
  return yEnd < yBase
    ? `M${x},${yBase}L${x},${yEnd + r}Q${x},${yEnd} ${x + r},${yEnd}L${x2 - r},${yEnd}Q${x2},${yEnd} ${x2},${yEnd + r}L${x2},${yBase}Z`
    : `M${x},${yBase}L${x},${yEnd - r}Q${x},${yEnd} ${x + r},${yEnd}L${x2 - r},${yEnd}Q${x2},${yEnd} ${x2},${yEnd - r}L${x2},${yBase}Z`;
}
