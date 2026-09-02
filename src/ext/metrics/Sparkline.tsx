import { useMemo } from "react";
import type { ReactNode } from "react";
import type { TimeSeries } from "../../runtime";

/**
 * A history sparkline. [dev-toolbar/ext/metrics]
 *
 * Reads the ring buffer via `copyInto` into a `Float64Array` allocated once by
 * this component. Re-renders on `revision`, not on every sample.
 */
export interface SparklineProps {
  series: TimeSeries;
  /** Snapshot revision. Changing it is what makes this re-read the ring. */
  revision: number;
  label: string;
}

const WIDTH = 240;
const HEIGHT = 40;

export function Sparkline({ series, revision, label }: SparklineProps): ReactNode {
  // One allocation per capacity, not per render.
  const buffer = useMemo(() => new Float64Array(series.capacity), [series.capacity]);

  const path = useMemo(() => {
    void revision;
    const count = series.values.copyInto(buffer);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let usable = 0;
    for (let index = 0; index < count; index += 1) {
      const value = buffer[index] as number;
      if (!Number.isFinite(value)) continue;
      usable += 1;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (usable < 2) return null;

    // A flat series should sit in the middle, not on the floor.
    const span = max - min || 1;
    const step = count > 1 ? WIDTH / (count - 1) : WIDTH;
    let d = "";
    let started = false;
    for (let index = 0; index < count; index += 1) {
      const value = buffer[index] as number;
      if (!Number.isFinite(value)) {
        started = false;
        continue;
      }
      const x = index * step;
      const y = max === min ? HEIGHT / 2 : HEIGHT - 2 - ((value - min) / span) * (HEIGHT - 4);
      d += `${started ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      started = true;
    }
    return d === "" ? null : d;
  }, [series, buffer, revision]);

  return (
    <svg
      data-dtb-part="metrics-sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} history`}
    >
      {path ? <path d={path} /> : null}
    </svg>
  );
}
