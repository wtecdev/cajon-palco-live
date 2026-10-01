// Constantes compartilhadas entre app, AudioWorklet, testes e ferramentas.

// Golpes do cajón (seção 3.1) + complementos opcionais.
export const GOLPES = {
  B: 'Grave',
  S: 'Tapa / slap',
  T: 'Tom / aro',
  g: 'Ghost',
  r: 'Rufo',
  H: 'Chimbal (condução)',
  P: 'Pandeirola',
};
export const GOLPES_CAJON = ['B', 'S', 'T', 'g', 'r'];
export const COMPLEMENTOS = ['H', 'P'];

// Intensidade 0–127 → ganho linear: ganho = intensidade/100 × REF[golpe].
// Referências escolhidas para que o maior ganho da v1 caiba em 127 sem cortar
// (ver tools/migrar_v1.mjs).
export const REF = { B: 1.1, S: 1.1, T: 1.1, r: 1.1, g: 0.32, H: 0.7, P: 0.6 };

export const BPM_MIN = 40;
export const BPM_MAX = 240;

// Janela de decisão: um tempo é "fechado" (seus golpes agendados) este tanto antes de soar.
// Comando que chega depois disso vale para o tempo/compasso seguinte.
export const COMMIT_AHEAD_S = 0.05;

// Limites de segurança do deslocamento de um golpe (microdesvio + humanização).
export const DESVIO_MAX_MS = 40;

export const clampBpm = (v) => Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(Number(v) * 10) / 10));
