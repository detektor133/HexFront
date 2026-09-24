// CIELAB и CIEDE2000 для проверки палитр; только тесты, в рантайм не идёт.

export type Lab = readonly [number, number, number];

function linear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB #RRGGBB → CIELAB (D65). */
export function toLab(hex: string): Lab {
  const [r, g, b] = [1, 3, 5].map((i) => linear(Number.parseInt(hex.slice(i, i + 2), 16))) as [
    number,
    number,
    number,
  ];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const rad = (d: number): number => (d * Math.PI) / 180;

/** Цветовое различие CIEDE2000. */
export function deltaE2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const cm = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1 = Math.hypot(a1p, b1);
  const c2 = Math.hypot(a2p, b2);
  const h1 = ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360;
  const h2 = ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360;
  let dh = c1 * c2 === 0 ? 0 : h2 - h1;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(rad(dh / 2));
  const lm = (l1 + l2) / 2;
  const cmp = (c1 + c2) / 2;
  let hm = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : (h1 + h2 + 360) / 2;
  if (c1 * c2 === 0) hm = h1 + h2;
  const t =
    1 -
    0.17 * Math.cos(rad(hm - 30)) +
    0.24 * Math.cos(rad(2 * hm)) +
    0.32 * Math.cos(rad(3 * hm + 6)) -
    0.2 * Math.cos(rad(4 * hm - 63));
  const sl = 1 + (0.015 * (lm - 50) ** 2) / Math.sqrt(20 + (lm - 50) ** 2);
  const sc = 1 + 0.045 * cmp;
  const sh = 1 + 0.015 * cmp * t;
  const rt =
    -2 *
    Math.sqrt(cmp ** 7 / (cmp ** 7 + 25 ** 7)) *
    Math.sin(rad(60 * Math.exp(-(((hm - 275) / 25) ** 2))));
  const dl = (l2 - l1) / sl;
  const dc = (c2 - c1) / sc;
  const dhh = dH / sh;
  return Math.sqrt(dl * dl + dc * dc + dhh * dhh + rt * dc * dhh);
}
