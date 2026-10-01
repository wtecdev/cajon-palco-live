// Configuração persistida (localStorage). Prefixo próprio para não colidir com a v1 no mesmo domínio.

import { DEFAULT_PARAMS } from './core/sequencer.js';
import { MAPA_PADRAO } from './input.js';

const KEY = 'cpp2:config:v3'; // v3: batidas com nome de estilo + repertório

export const CONFIG_PADRAO = () => ({
  slots: { A: 'baladaLeve', B: 'baladaCheia' },
  musica: 'Patience',
  bpm: 60,
  params: JSON.parse(JSON.stringify(DEFAULT_PARAMS)),
  mix: {
    // volumes 0–150 por golpe (v1: cajón 82, chimbal 52, pandeirola 58)
    volumes: { B: 82, S: 82, T: 82, g: 82, r: 82, H: 52, P: 58 },
    eq: { grave: 0, medio: 0, agudo: 0 }, // neutro, igual aos demos (a v1 usava +4/−2/−6, som mais escuro)
    compLigado: false, // desligado por padrão; os ajustes abaixo são os da v1, se quiser ligar
    comp: { limiar: -8, joelho: 6, razao: 10, ataque: 0.003, soltura: 0.14 }, // valores da v1
    limLigado: true,
    master: 0.5, // o kit atual passa de 0 dBFS; 0,5 deixa o limitador só nos picos, como nos demos
  },
  pedal: MAPA_PADRAO(),
  kit: 'data/kits/v1-kit3/',
});

export function carregar() {
  const base = CONFIG_PADRAO();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    return {
      ...base, ...s,
      params: { ...base.params, ...s.params, trilhas: { ...base.params.trilhas, ...(s.params && s.params.trilhas) } },
      mix: { ...base.mix, ...s.mix, volumes: { ...base.mix.volumes, ...(s.mix && s.mix.volumes) }, eq: { ...base.mix.eq, ...(s.mix && s.mix.eq) }, comp: { ...base.mix.comp, ...(s.mix && s.mix.comp) } },
      pedal: { ...base.pedal, ...s.pedal },
      slots: { ...base.slots, ...s.slots },
    };
  } catch (_) { return base; }
}

let timer = null, pendente = null;
const gravar = () => { if (!pendente) return; try { localStorage.setItem(KEY, JSON.stringify(pendente)); } catch (_) {} pendente = null; };
export function salvar(cfg) {
  pendente = cfg;
  clearTimeout(timer);
  timer = setTimeout(gravar, 150);
}
// grava na hora se a página for fechada/recarregada/escondida antes do atraso
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', gravar);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') gravar(); });
}
