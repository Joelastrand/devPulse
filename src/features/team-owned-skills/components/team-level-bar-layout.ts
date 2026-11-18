/**
 * Layout of the team level bar chart, kept apart from the chart module so a lazily loaded chart can reserve the same
 * height without importing `recharts`.
 */
export const LEVEL_BAR_ROW_HEIGHT = 40;
export const LEVEL_BAR_CHART_PADDING = 48;

export function levelBarChartHeight(rowCount: number): number {
  return LEVEL_BAR_CHART_PADDING + rowCount * LEVEL_BAR_ROW_HEIGHT;
}
