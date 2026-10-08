import type { Graphics } from 'pixi.js';

export interface GraphicsTelemetry {
  readonly id: number;
  readonly instructions: number;
  readonly vertices: number;
  readonly rebuildsPerSecond: number;
}

interface GraphicsRebuildCounter {
  count: number;
  sampledCount: number;
  sampledAt: number;
}

const graphicsRebuildCounters = new WeakMap<object, GraphicsRebuildCounter>();

function graphicsVertexCount(graphics: Graphics): number {
  let vertices = 0;
  for (const gpuData of Object.values(graphics.context._gpuData)) {
    vertices = Math.max(vertices, Math.floor(gpuData.geometryData.vertices.length / 2));
  }
  return vertices;
}

/** Собирает число вершин и частоту перестроения геометрии Graphics за интервал telemetry. */
export function graphicsTelemetry(graphics: Graphics, nowMs: number): GraphicsTelemetry {
  const context = graphics.context;
  let counter = graphicsRebuildCounters.get(context);
  if (!counter) {
    const current: GraphicsRebuildCounter = { count: 0, sampledCount: 0, sampledAt: nowMs };
    context.on('update', () => {
      current.count += 1;
    });
    graphicsRebuildCounters.set(context, current);
    counter = current;
  }
  const elapsedMs = nowMs - counter.sampledAt;
  const rebuildsPerSecond =
    elapsedMs > 0 ? ((counter.count - counter.sampledCount) * 1000) / elapsedMs : 0;
  counter.sampledCount = counter.count;
  counter.sampledAt = nowMs;
  return {
    id: context.uid,
    instructions: graphics.context.instructions.length,
    vertices: graphicsVertexCount(graphics),
    rebuildsPerSecond,
  };
}
