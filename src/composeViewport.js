const DEFAULT_NODE_WIDTH = 230;
const DEFAULT_NODE_HEIGHT = 104;

export function calculateGraphFit({
  positions,
  viewportWidth,
  viewportHeight,
  nodeWidth = DEFAULT_NODE_WIDTH,
  nodeHeight = DEFAULT_NODE_HEIGHT,
  padding = 24,
  minScale = 0.3,
  maxScale = 1,
}) {
  const values = Object.values(positions ?? {}).filter((position) => Number.isFinite(position?.x) && Number.isFinite(position?.y));
  if (!values.length || viewportWidth <= 0 || viewportHeight <= 0) {
    return { scale: 1, scrollLeft: 0, scrollTop: 0 };
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
  };
}
