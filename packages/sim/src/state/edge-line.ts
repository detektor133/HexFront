// Нормализация линии по граням (04/T14): одна грань — один EdgeId, без повторов и петель.
// Палец, вернувшийся назад, стирает линию до этого места — то же правило вырезает петли в
// команде, поэтому клиент и sim получают одну и ту же линию.
// GDD: docs/gdd/07-controls.md — «Линия наступления».
import {
  cornerKey,
  edgeChain,
  edgeCorners,
  edgeNeighbors,
  flipEdge,
  isLandEdge,
  limitOf,
  type EdgeId,
} from './edges.ts';
import type { LineGround } from './ground.ts';

/** Одна грань — один EdgeId: меньший из двух сторон (у края карты — единственный). */
export function canonicalEdge(g: LineGround, e: EdgeId): EdgeId {
  const f = flipEdge(g, e);
  return f >= 0 && f < e ? f : e;
}

/**
 * Линия без повторов и петель: грани приводятся к одному EdgeId; грань, пришедшая в уже
 * пройденный угол, обрезает линию до этого угла (возврат назад стирает, петля вырезается). Грани, не сходящиеся в углу с концом линии, продолжают её как есть.
 * @returns грани по порядку
 */
export function normalizeLine(g: LineGround, edges: readonly EdgeId[]): EdgeId[] {
  const out: EdgeId[] = [];
  // Углы линии по порядку: corners.length = out.length + 1, пока линия не пуста.
  let corners: number[] = [];
  for (const raw of edges) {
    const e = canonicalEdge(g, raw);
    const [a, b] = edgeCorners(e).map((c) => cornerKey(g, c)) as [number, number];
    if (out.length === 0) {
      out.push(e);
      corners = [a, b];
      continue;
    }
    // Первая грань развёрнута так, чтобы линия шла от угла, не общего со второй гранью.
    if (out.length === 1 && (corners[0] === a || corners[0] === b)) corners.reverse();
    const j = Math.max(corners.lastIndexOf(a), corners.lastIndexOf(b));
    if (j < 0) {
      out.push(e);
      corners.push(b);
      continue;
    }
    const other = corners[j] === a ? b : a;
    out.length = j;
    corners.length = j + 1;
    const i = corners.indexOf(other);
    if (i >= 0) {
      out.length = i;
      corners.length = i + 1;
    } else {
      out.push(e);
      corners.push(other);
    }
  }
  return out;
}

/**
 * Линия наступления по точкам-граням: точки приводятся к одному EdgeId, между ними — кратчайший
 * путь по граням суши (в одном EdgeId), затем повторы и петли убираются (`normalizeLine`).
 * @returns грани по порядку или null, если точки не на суше, их не соединить или линия пуста
 */
export function offensiveEdgePath(g: LineGround, points: readonly EdgeId[]): EdgeId[] | null {
  if (points.length === 0 || points.some((e) => !isLandEdge(g, e))) return null;
  // Граф граней суши в одном EdgeId: соседи грани — с обеих её сторон, иначе путь к грани,
  // записанной со стороны соседа, шёл бы в обход.
  const next = (e: EdgeId): EdgeId[] => {
    const f = flipEdge(g, e);
    const around = [...edgeNeighbors(g, e), ...(f >= 0 ? edgeNeighbors(g, f) : [])];
    const out = around.filter((x) => isLandEdge(g, x)).map((x) => canonicalEdge(g, x));
    return [...new Set(out)].sort((a, b) => a - b);
  };
  const path = edgeChain(
    points.map((e) => canonicalEdge(g, e)),
    next,
    limitOf(g),
    true,
  );
  const line = path ? normalizeLine(g, path) : [];
  return line.length > 0 ? line : null;
}
