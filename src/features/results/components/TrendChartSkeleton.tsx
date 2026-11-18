import { Card } from "../../../components/ui/Card";
import { ChartPlaceholder } from "../../../components/ui/LazyChart";
import { resultsCopy } from "../copy";

/**
 * Same heading, description and plot box as `TrendChart`, so the card keeps its height while the chart code or data
 * arrives. The plot box is decorative. Pass `label` only where the chart is the region's one announced loading state:
 * home panels stay silent, the results route announces once.
 */
export function TrendChartSkeleton({ label }: { label?: string }) {
  return (
    <Card as="section" variant="bordered" padding="md" aria-labelledby="trend-chart-skeleton-heading">
      {label ? (
        <span role="status" className="sr-only">
          {label}
        </span>
      ) : null}
      <h2 id="trend-chart-skeleton-heading" className="text-lg font-semibold text-text-primary">
        {resultsCopy.trendChart.heading}
      </h2>
      <p className="mt-1 text-sm text-text-muted">{resultsCopy.trendChart.description}</p>
      <ChartPlaceholder className="mt-4 h-64 w-full" />
    </Card>
  );
}
