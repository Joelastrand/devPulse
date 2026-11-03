import { useId, type ReactNode } from "react";
import { cx } from "./class-names";

/**
 * Chart container contract (docs/features/product-experience/SPEC.md — Chart
 * and analytics presentation). The frame only lays out what the caller passes.
 * It never receives or computes a value the server withheld, so it takes no
 * data props. Every chart is shown with a table alternative. When the data is
 * insufficient, the chart is replaced by the empty slot, and no zero is
 * inferred.
 */
interface ChartFrameBase {
  /** Accessible name of the figure and its visible title. */
  title: string;
  legend?: ReactNode;
  /** Text note beneath the chart, for example how suppressed points are shown. */
  note?: ReactNode;
  className?: string;
}

interface ChartFrameShown extends ChartFrameBase {
  insufficientData?: false;
  children: ReactNode;
  /** Required: every shown chart has a table alternative. */
  table: ReactNode;
  empty?: never;
}

interface ChartFrameInsufficient extends ChartFrameBase {
  insufficientData: true;
  /** Replaces the chart when there are too few responses to show a trend. */
  empty: ReactNode;
  children?: never;
  table?: never;
}

export type ChartFrameProps = ChartFrameShown | ChartFrameInsufficient;

export function ChartFrame(props: ChartFrameProps) {
  const { title, legend, note, className } = props;
  const titleId = useId();

  if (props.insufficientData) {
    return (
      <figure aria-labelledby={titleId} className={cx("flex flex-col gap-3", className)}>
        <figcaption id={titleId} className="text-panel-title font-semibold text-text-primary">
          {title}
        </figcaption>
        {props.empty}
      </figure>
    );
  }

  return (
    <figure aria-labelledby={titleId} className={cx("flex flex-col gap-3", className)}>
      <figcaption id={titleId} className="text-panel-title font-semibold text-text-primary">
        {title}
      </figcaption>
      {legend ? <div className="flex flex-wrap gap-3 text-help text-text-muted">{legend}</div> : null}
      <div className="w-full overflow-x-auto">{props.children}</div>
      {note ? <p className="text-help text-text-muted">{note}</p> : null}
      <div className="overflow-x-auto">{props.table}</div>
    </figure>
  );
}
