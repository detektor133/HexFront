import { deflateSync } from 'node:zlib';

export interface TerritoryFrame {
  readonly t: number;
  readonly owner: readonly number[];
}

export interface TerritoryPalette {
  readonly terrain: readonly string[];
  readonly players: readonly string[];
  readonly background: string;
}

function colorBytes(value: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error(`некорректный цвет: ${value}`);
  const hex = match[1] ?? '';
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4), 16),
  ];
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  new DataView(result.buffer).setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  new DataView(result.buffer).setUint32(
    8 + data.length,
    crc32(result.subarray(4, 8 + data.length)),
  );
  return result;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function png(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const scanlines = new Uint8Array(height * (width * 3 + 1));
  for (let row = 0; row < height; row += 1) {
    const source = row * width * 3;
    const target = row * (width * 3 + 1);
    scanlines[target] = 0;
    scanlines.set(pixels.subarray(source, source + width * 3), target + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  return concat([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', new Uint8Array()),
  ]);
}

function fillCell(
  pixels: Uint8Array,
  sheetWidth: number,
  x: number,
  y: number,
  size: number,
  color: readonly [number, number, number],
): void {
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const offset = ((y + row) * sheetWidth + x + col) * 3;
      pixels[offset] = color[0] ?? 0;
      pixels[offset + 1] = color[1] ?? 0;
      pixels[offset + 2] = color[2] ?? 0;
    }
  }
}

export function renderTerritoryTimelapse(
  width: number,
  height: number,
  terrain: readonly number[],
  frames: readonly TerritoryFrame[],
  palette: TerritoryPalette,
): Uint8Array {
  if (frames.length === 0) throw new Error('таймлапс территории: нет кадров');
  const cell = 4;
  const gap = 2;
  const frameWidth = width * cell;
  const frameHeight = height * cell;
  const columns = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / columns);
  const sheetWidth = columns * frameWidth + (columns - 1) * gap;
  const sheetHeight = rows * frameHeight + (rows - 1) * gap;
  const background = colorBytes(palette.background);
  const terrainColors = palette.terrain.map(colorBytes);
  const playerColors = palette.players.map(colorBytes);
  const pixels = new Uint8Array(sheetWidth * sheetHeight * 3);
  for (let i = 0; i < sheetWidth * sheetHeight; i += 1) {
    pixels[i * 3] = background[0] ?? 0;
    pixels[i * 3 + 1] = background[1] ?? 0;
    pixels[i * 3 + 2] = background[2] ?? 0;
  }
  frames.forEach((frame, frameIndex) => {
    const originX = (frameIndex % columns) * (frameWidth + gap);
    const originY = Math.floor(frameIndex / columns) * (frameHeight + gap);
    for (let id = 0; id < width * height; id += 1) {
      const owner = frame.owner[id] ?? -1;
      const terrainCode = terrain[id] ?? 0;
      const color =
        owner >= 0 ? playerColors[owner % playerColors.length] : terrainColors[terrainCode];
      if (!color) continue;
      fillCell(
        pixels,
        sheetWidth,
        originX + (id % width) * cell,
        originY + Math.floor(id / width) * cell,
        cell,
        color,
      );
    }
  });
  return png(sheetWidth, sheetHeight, pixels);
}
