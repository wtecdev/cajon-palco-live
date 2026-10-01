// Repertórios do Bin: criados e editados no próprio aparelho (localStorage), com exportar/importar em arquivo .json.
// O catálogo por artista continua vindo do app (só leitura). Cada música guarda de onde veio (origem) para receber
// as correções de batida/BPM que forem publicadas depois.

export const CHAVE = 'cpp2:repertorios:v1';
export const FORMATO = 'cajon_repertorios_v1';

const CAMPOS = ['titulo', 'artista', 'batidaA', 'batidaB', 'bpm', 'fonte_bpm', 'nota', 'adaptacao', 'inicio'];
export const novoId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function copiaMusica(m, origem) {
  const c = {};
  for (const k of CAMPOS) if (m[k] !== undefined && m[k] !== null) c[k] = m[k];
  if (!('batidaA' in c)) c.batidaA = null;
  c.origem = origem || m.origem || null;
  return c;
}

// primeira vez: as listas que vêm com o app viram repertórios do Bin
export function semear(listasDoApp) {
  return listasDoApp.map((r) => ({ id: novoId(), nome: r.nome, musicas: r.musicas.map((m) => copiaMusica(m, r.nome)) }));
}

export function ler(storage) {
  try {
    const raw = storage && storage.getItem(CHAVE);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return Array.isArray(d.repertorios) ? d.repertorios : null;
  } catch (_) { return null; }
}
export function gravar(storage, meus) {
  try { storage.setItem(CHAVE, JSON.stringify({ formato: FORMATO, repertorios: meus })); return true; } catch (_) { return false; }
}

// traz batida/BPM atualizados do repertório de origem (que vem com o app), quando ele ainda existe
export function atualizar(meus, doApp) {
  const porNome = new Map(doApp.map((r) => [r.nome, r]));
  let n = 0;
  for (const r of meus) for (const m of r.musicas) {
    const o = m.origem && porNome.get(m.origem);
    const f = o && o.musicas.find((x) => x.titulo === m.titulo);
    if (!f) continue;
    for (const k of CAMPOS) {
      const v = f[k] === undefined ? undefined : f[k];
      if (v === undefined) { if (k !== 'titulo' && k in m && k !== 'batidaA') { delete m[k]; n++; } continue; }
      if (m[k] !== v) { m[k] = v; n++; }
    }
  }
  return n; // quantos campos mudaram
}

export function criar(meus, nome) {
  const r = { id: novoId(), nome: nomeLivre(meus, nome || 'Novo repertório'), musicas: [] };
  meus.push(r);
  return r;
}
export function nomeLivre(meus, nome, ignorarId) {
  const base = String(nome).trim() || 'Novo repertório';
  let n = base, k = 2;
  while (meus.some((r) => r.nome === n && r.id !== ignorarId)) n = `${base} (${k++})`;
  return n;
}
export function renomear(meus, id, nome) {
  const r = meus.find((x) => x.id === id);
  if (r) r.nome = nomeLivre(meus, nome, id);
  return r;
}
export function apagar(meus, id) {
  const i = meus.findIndex((x) => x.id === id);
  if (i >= 0) meus.splice(i, 1);
  return i >= 0;
}
export function contem(r, m) { return r.musicas.some((x) => x.titulo === m.titulo && (x.artista || '') === (m.artista || '')); }
export function adicionar(meus, id, m, origem) {
  const r = meus.find((x) => x.id === id);
  if (!r || contem(r, m)) return false;
  r.musicas.push(copiaMusica(m, origem));
  return true;
}
export function remover(meus, id, i) {
  const r = meus.find((x) => x.id === id);
  if (!r || i < 0 || i >= r.musicas.length) return false;
  r.musicas.splice(i, 1);
  return true;
}
export function mover(meus, id, i, dir) {
  const r = meus.find((x) => x.id === id);
  const j = i + dir;
  if (!r || i < 0 || j < 0 || j >= r.musicas.length) return false;
  [r.musicas[i], r.musicas[j]] = [r.musicas[j], r.musicas[i]];
  return true;
}

export function exportar(meus) {
  return JSON.stringify({ formato: FORMATO, exportado_em: new Date().toISOString(), repertorios: meus }, null, 1);
}
// importar: repertório com o mesmo nome é substituído; os outros entram novos. Devolve quantos entraram.
export function importar(meus, texto) {
  const d = JSON.parse(texto);
  if (!d || d.formato !== FORMATO || !Array.isArray(d.repertorios)) throw new Error('arquivo não é de repertórios do Cajón Palco Pro');
  let n = 0;
  for (const r of d.repertorios) {
    if (!r || typeof r.nome !== 'string' || !Array.isArray(r.musicas)) continue;
    const limpo = { id: novoId(), nome: r.nome, musicas: r.musicas.filter((m) => m && typeof m.titulo === 'string').map((m) => copiaMusica(m)) };
    const i = meus.findIndex((x) => x.nome === r.nome);
    if (i >= 0) meus[i] = { ...limpo, id: meus[i].id }; else meus.push(limpo);
    n++;
  }
  return n;
}
