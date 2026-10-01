// Padrões rítmicos: validação, compilação para o sequenciador e visualização em texto (seção 3.4).

import { GOLPES, DESVIO_MAX_MS } from './constants.js';

const CONTAGEM = {
  1: ['1'],
  2: ['1', '&'],
  3: ['1', '&', 'a'],
  4: ['1', 'e', '&', 'a'],
  6: ['1', '.', '&', '.', 'a', '.'],
};
// Prioridade para escolher o caractere de um passo na linha do cajón.
const PRIORIDADE = ['B', 'S', 'T', 'r', 'g'];

export function validatePattern(p) {
  const err = [];
  const need = (cond, msg) => { if (!cond) err.push(msg); };
  need(p && typeof p === 'object', 'padrão vazio');
  if (err.length) return err;
  need(typeof p.id === 'string' && p.id, 'id ausente');
  need(typeof p.nome === 'string' && p.nome, 'nome ausente');
  need(Number.isInteger(p.pulsos) && p.pulsos >= 1 && p.pulsos <= 12, 'pulsos deve ser inteiro 1–12');
  need(Number.isInteger(p.passos_por_pulso) && p.passos_por_pulso >= 1 && p.passos_por_pulso <= 8, 'passos_por_pulso deve ser inteiro 1–8');
  need(Number.isInteger(p.compassos) && p.compassos >= 1 && p.compassos <= 16, 'compassos deve ser inteiro 1–16');
  need(typeof p.bpm === 'number' && p.bpm > 0, 'bpm inválido');
  need(p.origem && typeof p.origem.tipo === 'string', 'origem.tipo obrigatório (regra 2: padrão não se inventa, se valida)');
  need(Array.isArray(p.eventos), 'eventos deve ser lista');
  if (err.length) return err;
  const total = p.pulsos * p.passos_por_pulso * p.compassos;
  p.eventos.forEach((e, i) => {
    if (!Number.isInteger(e.passo) || e.passo < 0 || e.passo >= total) err.push(`evento ${i}: passo fora da grade (0–${total - 1})`);
    if (!(e.golpe in GOLPES)) err.push(`evento ${i}: golpe desconhecido "${e.golpe}"`);
    if (!(Number.isFinite(e.intensidade) && e.intensidade >= 0 && e.intensidade <= 127)) err.push(`evento ${i}: intensidade fora de 0–127`);
    if (e.microdesvio_ms != null && !(Math.abs(e.microdesvio_ms) <= DESVIO_MAX_MS)) err.push(`evento ${i}: microdesvio_ms fora de ±${DESVIO_MAX_MS}`);
  });
  return err;
}

// Compila para o formato do sequenciador: eventos agrupados por [compasso][pulso].
export function compilePattern(p) {
  const errs = validatePattern(p);
  if (errs.length) throw new Error(`Padrão "${p && p.id}": ${errs.join('; ')}`);
  const spb = p.passos_por_pulso, ppc = p.pulsos * spb;
  const grid = Array.from({ length: p.compassos }, () => Array.from({ length: p.pulsos }, () => []));
  for (const e of p.eventos) {
    const bar = Math.floor(e.passo / ppc), inBar = e.passo % ppc;
    const beat = Math.floor(inBar / spb), sub = inBar % spb;
    grid[bar][beat].push({
      sub,
      golpe: e.golpe,
      vel: e.intensidade,
      devMs: e.microdesvio_ms || 0,
      variacao: e.variacao || null,
      taxa: e.taxa || 1,
      durMs: e.duracao_ms || 0,
    });
  }
  for (const bar of grid) for (const beat of bar) beat.sort((a, b) => a.sub - b.sub);
  return {
    id: p.id,
    nome: p.nome,
    pulsos: p.pulsos,
    spb,
    compassos: p.compassos,
    bpm: p.bpm,
    swing: (p.swing ?? 50) / 100,
    // força da batida (maior tapa e maior grave): a virada usa como referência para não "sumir"
    ref: {
      S: Math.max(0, ...p.eventos.filter((e) => e.golpe === 'S').map((e) => e.intensidade)) || 96,
      B: Math.max(0, ...p.eventos.filter((e) => e.golpe === 'B').map((e) => e.intensidade)) || 90,
    },
    grid,
  };
}

// Linha de contagem + linha de golpes (e complementos), como no exemplo da seção 3.4.
export function gridText(p, compasso = 0, { complementos = true } = {}) {
  const spb = p.passos_por_pulso, ppc = p.pulsos * spb;
  const cont = [];
  for (let b = 0; b < p.pulsos; b++) {
    const labels = CONTAGEM[spb] || Array.from({ length: spb }, (_, i) => (i ? '.' : '1'));
    labels.forEach((l, i) => cont.push(i === 0 ? String(b + 1) : l));
  }
  const cajon = Array(ppc).fill('.'), H = Array(ppc).fill('.'), P = Array(ppc).fill('.');
  const rank = Array(ppc).fill(99);
  for (const e of p.eventos) {
    if (Math.floor(e.passo / ppc) !== compasso) continue;
    const i = e.passo % ppc;
    if (e.golpe === 'H') H[i] = 'x';
    else if (e.golpe === 'P') P[i] = e.variacao === 'acento' ? 'X' : 'x';
    else {
      const r = PRIORIDADE.indexOf(e.golpe);
      if (r < rank[i]) { rank[i] = r; cajon[i] = e.golpe; }
    }
  }
  const w = Math.max(...cont.map((c) => c.length));
  const fmt = (arr) => arr.map((c) => c.padEnd(w)).join(' ');
  const lines = [`Contagem: ${fmt(cont)}`, `Golpe:    ${fmt(cajon)}`];
  if (complementos && H.includes('x')) lines.push(`Chimbal:  ${fmt(H)}`);
  if (complementos && P.some((c) => c !== '.')) lines.push(`Pandeir.: ${fmt(P)}`);
  return lines.join('\n');
}
