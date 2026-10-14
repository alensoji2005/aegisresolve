export type Rnd = () => number;

export function mulberry32(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (rnd: Rnd, lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
export const pick = <T>(rnd: Rnd, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
