// Viradas, final, contagem e marcação.
//
// ORIGEM: portados da v1 (playOneBeatTransitionFill, bloco 'final', countHat, playHoldMark).
// São adaptações da própria v1, não transcrições de fonte didática: validar de ouvido.
// Na v1, o "T" das viradas tocava a amostra de slap; aqui fica como S para soar igual.
//
// Cada virada ocupa UM pulso (o último antes do tempo 1), dividido em `n` passos.
// Retorna [{ sub, golpe, gain }] onde gain é o ganho da v1 (convertido pelo sequenciador).

export const ESTILOS_VIRADA = ['virada', 'repique', 'troca', 'saida', 'entrada', 'compasso', 'reta'];

export function viradaUmPulso(estilo, n) {
  const out = [];
  const add = (sub, golpe, gain) => out.push({ sub, golpe, gain });
  const mid = Math.max(1, Math.floor(n / 2)), last = Math.max(1, n - 1);
  for (let rel = 0; rel < n; rel++) {
    switch (estilo) {
      case 'entrada':
        if (rel === 0) add(rel, 'g', 0.2);
        if (n >= 4 && rel === Math.max(1, Math.floor(n * 0.4))) add(rel, 'g', 0.3);
        if (rel === mid) add(rel, 'S', 0.55);
        if (rel === last) { add(rel, 'B', 0.85); add(rel, 'S', 0.7); }
        break;
      case 'saida':
        if (rel === 0) add(rel, 'S', 0.5);
        if (rel === mid) add(rel, 'B', 0.75);
        if (rel === last) { add(rel, 'B', 0.95); add(rel, 'S', 0.85); }
        break;
      case 'troca':
        if (rel === 0) add(rel, 'B', 0.6);
        if (n >= 4 && rel === Math.max(1, Math.floor(n * 0.33))) add(rel, 'g', 0.22);
        if (rel === mid) add(rel, 'B', 0.72);
        if (rel === last) add(rel, 'S', 0.8);
        break;
      case 'compasso':
        if (rel === last) { add(rel, 'B', 0.95); add(rel, 'S', 0.9); }
        else if (rel % 4 === 0) add(rel, 'B', 0.5 + (rel / n) * 0.25);
        else if (rel % 2 === 0) add(rel, 'S', 0.55 + (rel / n) * 0.2);
        break;
      case 'repique':
        if (rel === last) { add(rel, 'B', 0.85); add(rel, 'S', 0.9); }
        else add(rel, 'S', 0.4 + (rel / n) * 0.35);
        break;
      case 'reta':
        if (rel === 0) add(rel, 'B', 0.55);
        if (rel === mid) add(rel, 'B', 0.65);
        if (rel === last) add(rel, 'S', 0.85);
        break;
      default: // 'virada'
        if (rel === 0) add(rel, 'S', 0.54);
        if (rel === mid) add(rel, 'B', 0.68);
        if (rel === last) add(rel, 'S', 0.78);
        if (n >= 6 && rel === last - 1) add(rel, 'g', 0.24);
    }
  }
  return out;
}

// Virada ajustada ao andamento (adaptação deste projeto sobre as viradas da v1; validar de ouvido).
// As figuras da v1 foram pensadas para andamento médio: em 60 BPM "tapa . grave tapa" deixa meio segundo
// de buraco e soa como a batida tropeçando. Aqui, sem sair da grade da batida:
//  - muito lento (passo > 0,3 s): a grade da virada é dividida em 2 (ou 4), ex. semicolcheia → fusa;
//  - buraco maior que BURACO_MAX_S entre dois golpes da virada é preenchido com tapa crescendo
//    (mesma dinâmica do estilo 'repique' da v1), até o acento que volta no tempo 1.
// Em andamento médio/rápido a virada continua igual à da v1.
export const BURACO_MAX_S = 0.32;
export function viradaNoTempo(estilo, spb, pulsoS) {
  let n = Math.max(1, spb);
  while (pulsoS / n > 0.3 && n < Math.max(1, spb) * 4) n *= 2;
  const ev = viradaUmPulso(estilo, n);
  const passo = pulsoS / n;
  const com = new Set(ev.map((e) => e.sub));
  let ultimo = -1;
  for (let rel = 0; rel < n; rel++) {
    if (com.has(rel)) { ultimo = rel; continue; }
    let prox = rel + 1;
    while (prox < n && !com.has(prox)) prox++;
    if (ultimo >= 0 && (prox - ultimo) * passo > BURACO_MAX_S) {
      ev.push({ sub: rel, golpe: 'S', gain: 0.4 + (rel / n) * 0.35 });
      com.add(rel); ultimo = rel;
    }
  }
  ev.sort((x, y) => x.sub - y.sub);
  return { n, eventos: ev };
}

// Força da virada em relação à batida (adaptação deste projeto; validar de ouvido).
// Os ganhos da v1 (tapa 0,4–0,9; grave 0,5–0,95) foram feitos para o nível da v1. Com as batidas novas
// (tapa 96–112) a virada saía com menos da metade da força e parecia que a batida sumia antes do 1.
// Agora o golpe mais forte da virada chega na força da própria batida e o crescendo da v1 fica comprimido
// entre 72% e 100% dela. Ghost continua ghost.
export const GANHO_MAX_VIRADA = { S: 0.9, B: 0.95 };
export function forcaVirada(golpe, gain, ref) {
  const gmax = GANHO_MAX_VIRADA[golpe];
  if (!gmax || !ref || !ref[golpe]) return null; // sem referência: o sequenciador usa a conversão padrão
  return ref[golpe] * (0.72 + 0.28 * Math.min(1, gain / gmax));
}

// Acento final (v1: bass 1.2 + slap 1.1 + chimbal .82 + pandeirola .9 acento).
export const FINAL = [
  { golpe: 'B', gain: 1.2 },
  { golpe: 'S', gain: 1.1 },
  { golpe: 'H', gain: 0.82 },
  { golpe: 'P', gain: 0.9, variacao: 'acento' },
];

// Contagem (v1 countHat): chimbal em cada pulso, tempo 1 mais forte. Toca mesmo com o chimbal desligado.
export const contagem = (pulso) => [{ golpe: 'H', gain: pulso === 0 ? 0.72 : 0.55, forcar: true }];

// Marcação (pedal B na v1): grave em cada pulso; acima de 180 BPM só nos pulsos pares.
export function marcacao(pulso, bpm) {
  if (bpm > 180 && pulso % 2 === 1) return [];
  return [{ golpe: 'B', gain: pulso === 0 ? 1 : 0.84 }];
}

// Marcação leve de início (escolhida no app como "começar na marcação"): ghost em cada pulso,
// um pouco mais forte no 1 com grave bem fraco, e um ghost baixinho na subdivisão do compasso da
// música (no "&" em batidas retas; no "a" da tercina em shuffle). Fica assim até o pedal mandar entrar.
// Origem: pedido do Bin (28/09/2026); adaptação, validar de ouvido. Intensidades 0–127.
export function marcacaoLeve(pulso, spb) {
  const out = [{ sub: 0, golpe: 'g', vel: pulso === 0 ? 62 : 46 }];
  if (pulso === 0) out.push({ sub: 0, golpe: 'B', vel: 34 });
  if (spb === 3) out.push({ sub: 2, golpe: 'g', vel: 22 });
  else if (spb >= 2) out.push({ sub: spb / 2, golpe: 'g', vel: 20 });
  return out;
}
