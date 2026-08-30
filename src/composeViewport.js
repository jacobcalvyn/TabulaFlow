const DEFAULT_NODE_WIDTH = 230;
const DEFAULT_NODE_HEIGHT = 104;

export const MIN_MANUAL_SCALE = 0.3;
export const MIN_FIT_SCALE = 0.02;
export const MAX_CANVAS_COORDINATE = 32_000;

export function shouldAutoFitCanvasResize(previous, next, tolerance = 1) {
  if (!previous?.width || !previous?.height) return false;
  if (previous.previewOpen !== next.previewOpen) return false;
  return next.width < previous.width - tolerance || next.height < previous.height - tolerance;
}

export function normalizeCanvasPosition(position, fallback = { x: 40, y: 52 }) {
  const rawX = Number(position?.x);
  const rawY = Number(position?.y);
  const fallbackX = Number(fallback?.x);
  const fallbackY = Number(fallback?.y);
  const x = Number.isFinite(rawX) ? rawX : Number.isFinite(fallbackX) ? fallbackX : 40;
  const y = Number.isFinite(rawY) ? rawY : Number.isFinite(fallbackY) ? fallbackY : 52;
  return {
    x: Math.max(24, Math.min(MAX_CANVAS_COORDINATE, Math.round(x))),
    y: Math.max(24, Math.min(MAX_CANVAS_COORDINATE, Math.round(y))),
  };
}

export function calculateGraphFit({
  positions,
  viewportWidth,
  viewportHeight,
  nodeWidth = DEFAULT_NODE_WIDTH,
  nodeHeight = DEFAULT_NODE_HEIGHT,
  padding = 24,
  minScale = MIN_FIT_SCALE,
  maxScale = 1,
}) {
  const values = Object.values(positions ?? {}).filter((position) => Number.isFinite(position?.x) && Number.isFinite(position?.y));
  if (!values.length || viewportWidth <= 0 || viewportHeight <= 0) {
    return { scale: 1, scrollLeft: 0, scrollTop: 0, fits: true };
  }

  const minX = Math.min(...values.map((position) => position.x));
  const minY = Math.min(...values.map((position) => position.y));
  const maxX = Math.max(...values.map((position) => position.x + nodeWidth));
  const maxY = Math.max(...values.map((position) => position.y + nodeHeight));
  const graphWidth = Math.max(nodeWidth, maxX - minX);
  const graphHeight = Math.max(nodeHeight, maxY - minY);
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const scale = Math.max(minScale, Math.min(maxScale, availableWidth / graphWidth, availableHeight / graphHeight));
  const horizontalMargin = Math.max(padding, (viewportWidth - graphWidth * scale) / 2);
  const verticalMargin = Math.max(padding, (viewportHeight - graphHeight * scale) / 2);

  return {
    scale,
    scrollLeft: Math.max(0, minX * scale - horizontalMargin),
    scrollTop: Math.max(0, minY * scale - verticalMargin),
    fits: graphWidth * scale <= availableWidth + 0.5 && graphHeight * scale <= availableHeight + 0.5,
  };
}
