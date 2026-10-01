// Gerador pseudoaleatório determinístico (mulberry32): mesma semente, mesma humanização.
// Determinismo permite testar a humanização e reproduzir um problema relatado.

export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    // Aproximação de normal padrão (soma de 4 uniformes, desvio ~1), limitada a ±2.5.
    gauss() {
      const s = (next() + next() + next() + next() - 2) * Math.sqrt(3);
      return Math.max(-2.5, Math.min(2.5, s));
    },
    int(n) { return Math.floor(next() * n); },
  };
}
