function cssPixels(value: string): number {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}

export function measureCardHeight(
  card: HTMLElement,
  content: HTMLElement,
  entry: ResizeObserverEntry | undefined,
): number {
  const style = getComputedStyle(card);
  const contentHeight = Math.max(entry?.contentRect.height ?? 0, content.scrollHeight);
  const verticalPadding = cssPixels(style.paddingTop) + cssPixels(style.paddingBottom);
  const verticalBorder = cssPixels(style.borderTopWidth) + cssPixels(style.borderBottomWidth);
  return contentHeight + verticalPadding + verticalBorder;
}
