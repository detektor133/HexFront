// Чтение shapefile Natural Earth (полилинии и полигоны) и азимутальная проекция Ламберта.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Фигура слоя: кольца/линии в проекции плюс выбранные атрибуты DBF (в нижнем регистре). */
export interface Shape {
  readonly parts: readonly Point[][];
  readonly attrs: Readonly<Record<string, string>>;
}

/** Центр равновеликой азимутальной проекции Ламберта, градусы. */
export interface Center {
  readonly lon: number;
  readonly lat: number;
}

const RADIUS = 6_371_000;
const RAD = Math.PI / 180;

/** Проекция (lon, lat) → метры от центра; север — вверх по y. */
export function project(lon: number, lat: number, center: Center): Point {
  const longitude = lon * RAD;
  const latitude = lat * RAD;
  const sinLat = Math.sin(latitude);
  const cosLat = Math.cos(latitude);
  const sinCenter = Math.sin(center.lat * RAD);
  const cosCenter = Math.cos(center.lat * RAD);
  const delta = longitude - center.lon * RAD;
  const scale = Math.sqrt(2 / (1 + sinCenter * sinLat + cosCenter * cosLat * Math.cos(delta)));
  return {
    x: RADIUS * scale * cosLat * Math.sin(delta),
    y: RADIUS * scale * (cosCenter * sinLat - sinCenter * cosLat * Math.cos(delta)),
  };
}

function dbfRecords(buffer: Buffer): Record<string, string>[] {
  const records = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields: { name: string; offset: number; length: number }[] = [];
  let offset = 1;
  for (let at = 32; at < headerLength - 1; at += 32) {
    const length = buffer[at + 16] ?? 0;
    fields.push({
      name: buffer
        .toString('ascii', at, at + 11)
        .replace(/\0.*$/, '')
        .toLowerCase(),
      offset,
      length,
    });
    offset += length;
  }
  const wanted = fields.filter(
    (field) => field.name === 'featurecla' || field.name === 'scalerank',
  );
  return Array.from({ length: records }, (_, index) => {
    const row: Record<string, string> = {};
    for (const field of wanted) {
      const start = headerLength + index * recordLength + field.offset;
      row[field.name] = buffer.toString('latin1', start, start + field.length).trim();
    }
    return row;
  });
}

/**
 * Читает слой `<name>.shp/.dbf` из каталога; берутся только линии (тип 3) и полигоны (тип 5).
 * Кольца, не пересекающие `keep` (прямоугольник проекции), отбрасываются: они не влияют на карту.
 */
export async function readShapes(
  directory: string,
  name: string,
  center: Center,
  keep: { min: Point; max: Point },
): Promise<Shape[]> {
  const shp = await readFile(join(directory, `${name}.shp`));
  const attrs = dbfRecords(await readFile(join(directory, `${name}.dbf`)));
  const shapes: Shape[] = [];
  let offset = 100;
  let index = 0;
  while (offset + 8 <= shp.length) {
    const words = shp.readInt32BE(offset + 4);
    const recordEnd = offset + 8 + words * 2;
    const type = shp.readInt32LE(offset + 8);
    if ((type === 3 || type === 5) && recordEnd <= shp.length) {
      const partsCount = shp.readInt32LE(offset + 8 + 36);
      const pointsCount = shp.readInt32LE(offset + 8 + 40);
      const partsOffset = offset + 8 + 44;
      const pointsOffset = partsOffset + partsCount * 4;
      const parts: Point[][] = [];
      for (let p = 0; p < partsCount; p += 1) {
        const start = shp.readInt32LE(partsOffset + p * 4);
        const end = p + 1 < partsCount ? shp.readInt32LE(partsOffset + (p + 1) * 4) : pointsCount;
        const ring: Point[] = [];
        let [lowX, lowY, highX, highY] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = start; i < end; i += 1) {
          const at = pointsOffset + i * 16;
          const point = project(shp.readDoubleLE(at), shp.readDoubleLE(at + 8), center);
          ring.push(point);
          lowX = Math.min(lowX, point.x);
          highX = Math.max(highX, point.x);
          lowY = Math.min(lowY, point.y);
          highY = Math.max(highY, point.y);
        }
        const overlaps =
          highX >= keep.min.x && lowX <= keep.max.x && highY >= keep.min.y && lowY <= keep.max.y;
        if (overlaps) parts.push(ring);
      }
      if (parts.length > 0) shapes.push({ parts, attrs: attrs[index] ?? {} });
    }
    index += 1;
    offset = recordEnd;
  }
  return shapes;
}
