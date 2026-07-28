type Row = Record<string, unknown>;

const TOP = -Math.PI / 2;
const TAU = Math.PI * 2;

export type PieSlice = {
  name: string;
  value: number;
  start: number; // radians
  end: number;
  mid: number;
};

/** Slice angles from each data row's value under `dataKey`, named by `nameKey`. */
export function pieSlices(data: Row[], dataKey: string, nameKey: string): PieSlice[] {
  const vals = data.map((r) => Math.max(0, Number(r[dataKey]) || 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  let a = TOP;
  return data.map((r, i) => {
    const span = (vals[i] / total) * TAU;
    const slice = {
      name: String(r[nameKey] ?? i),
      value: vals[i],
      start: a,
      end: a + span,
      mid: a + span / 2,
    };
    a += span;
    return slice;
  });
}

/** Which slice a pointer angle falls in (or -1). */
export function sliceAtAngle(slices: PieSlice[], angle: number): number {
  // Normalize so comparisons against [start, end) (which begin at TOP) work.
  let a = angle;
  while (a < TOP) a += TAU;
  while (a >= TOP + TAU) a -= TAU;
  return slices.findIndex((s) => a >= s.start && a < s.end);
}
