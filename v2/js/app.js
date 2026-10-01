// Cajón Palco Pro — app (thread principal). Liga motor, pedais, telas e persistência.

import { Engine } from './engine.js';
import { PedalInput, LETRAS } from './input.js';
import { TelaAcesa } from './wakelock.js';
import { carregar, salvar } from './storage.js';
import { compilePattern, gridText } from './core/pattern.js';
import { TapTempo } from './core/tap.js';
import { ESTILOS_VIRADA } from './core/fills.js';
import { GOLPES, clampBpm } from './core/constants.js';
import { TesteLatencia, TesteEstabilidade, textoEstabilidade } from './testes.js';
import { VERSAO, MOTOR } from './versao.js';
import * as MR from './meus-repertorios.js';

const $ = (id) => document.getElementById(id);
const cfg = carregar();
const engine = new Engine();
const tela = new TelaAcesa();
const tap = new TapTempo();
const pedal = new PedalInput(cfg.pedal);
const lat = new TesteLatencia(engine);
const stab = new TesteEstabilidade(engine);

let biblioteca = [];
const porId = new Map();
const estado = { state: 'stopped', active: 'A', hold: false };
let ligando = null;
let swReg = null;

const ACOES = { A: 'Play / parar (com virada)', B: '1 toque: só grave · 2 toques: marcação leve · de novo: volta à batida', C: 'Virada no fim do compasso', D: 'Troca A ↔ B no próximo 1' };

// ---------------------------------------------------------------- avisos
function aviso(id, texto, { tipo = 'erro', botao, acao } = {}) {
  let el = document.getElementById('aviso-' + id);
  if (!texto) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'aviso-' + id; $('avisos').appendChild(el); }
  el.className = 'aviso' + (tipo === 'info' ? ' info' : '');
  el.innerHTML = '';
  const s = document.createElement('span'); s.textContent = texto; el.appendChild(s);
  if (botao) { const b = document.createElement('button'); b.textContent = botao; b.onclick = acao; el.appendChild(b); }
}

// ---------------------------------------------------------------- abas
document.querySelectorAll('.abas button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.abas button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.aba').forEach((s) => s.classList.toggle('ativa', s.id === 'aba-' + b.dataset.aba));
    if (b.dataset.aba === 'sistema') renderSistema();
  };
});

// ---------------------------------------------------------------- biblioteca
async function carregarBiblioteca() {
  // bibliotecas: novos padrões primeiro, depois os migrados da v1
  biblioteca = [];
  for (const arq of ['data/patterns/batidas.json']) { // batidas com nome de estilo, escritas do zero
    const j = await (await fetch(arq)).json();
    biblioteca.push(...j.padroes);
  }
  for (const p of biblioteca) porId.set(p.id, p);
  if (!porId.has(cfg.slots.A)) cfg.slots.A = biblioteca[0].id;
  if (cfg.slots.B && !porId.has(cfg.slots.B)) cfg.slots.B = null;
  preencherSelects();
  renderPadrao();
  renderSlotsPalco();
  await carregarRepertorios();
}

// ---------------------------------------------------------------- repertório (música → batida A/B + BPM)
let repertorios = [];
// meus = repertórios do Bin (editáveis, gravados no aparelho); doApp = listas + catálogo que vêm com o app
let meus = [], doApp = [];
const armazem = (() => { try { return window.localStorage; } catch (_) { return null; } })();
async function carregarRepertorios() {
  const idx = await (await fetch('data/setlists/index.json')).json();
  doApp = await Promise.all(idx.repertorios.map(async (x) => (await fetch(x.arquivo)).json()));
  const lidos = MR.ler(armazem);
  meus = lidos || MR.semear(doApp.filter((r) => !r.artista));
  if (MR.atualizar(meus, doApp) || !lidos) MR.gravar(armazem, meus);
  montarRepertorios(cfg.repertorio);
  abrirNoCatalogo();
}
// ao abrir o app o Palco fica sempre no Catálogo A–Z. Se a última lista era um repertório meu, vai para o
// artista da música atual no catálogo (a música continua a mesma); sem esse artista, fica em "escolha o artista".
function abrirNoCatalogo() {
  const r = repAtual();
  if (!r || r.artista) return;
  const m = r.musicas.find((x) => x.titulo === cfg.musica);
  const art = m && m.artista && repertorios.find((c) => c.artista && semAcento(c.artista) === semAcento(m.artista) && c.musicas.some((x) => x.titulo === m.titulo && x.batidaA));
  if (art) { montarRepertorios(art.nome); return; }
  modoFonte = 'cat';
  montarPalcoRep();
}
function gravarMeus(nomeSel) { MR.gravar(armazem, meus); montarRepertorios(nomeSel ?? (repAtual() && repAtual().nome)); }
function montarRepertorios(nomeSel) {
  repertorios = [...meus.map((r) => ({ ...r, meu: true })), ...doApp.filter((r) => r.artista)];
  const i = repertorios.findIndex((r) => r.nome === nomeSel);
  // aba Padrões: uma lista só, separada em grupos ("Meus repertórios" na ordem do Bin; catálogo por artista A–Z)
  const sel = $('repSel');
  const gL = document.createElement('optgroup'), gC = document.createElement('optgroup');
  gL.label = 'Meus repertórios'; gC.label = 'Catálogo por artista (A–Z)';
  sel.innerHTML = '';
  repertorios.forEach((r, k) => (r.artista ? gC : gL).appendChild(new Option(`${r.artista || r.nome} (${r.musicas.filter((m) => m.batidaA).length})`, String(k))));
  sel.append(gC, gL);
  sel.value = String(i >= 0 ? i : 0);
  cfg.repertorio = repAtual().nome;
  // Palco: chave "Meus repertórios | Catálogo" e a lista só do que foi escolhido, sem prefixo nos nomes
  modoFonte = repAtual().artista ? 'cat' : 'rep';
  montarPalcoRep();
  montarIndiceBusca();
  renderMusicas();
}
let modoFonte = 'rep';
function montarPalcoRep() {
  const sel = $('palcoRep'), atual = Number($('repSel').value) || 0, cat = modoFonte === 'cat';
  sel.innerHTML = '';
  if (!!repertorios[atual].artista !== cat) { const o = new Option(cat ? '— escolha o artista —' : '— escolha o repertório —', ''); o.disabled = true; sel.add(o); }
  repertorios.forEach((r, k) => { if (!!r.artista === cat) sel.add(new Option(r.artista || r.nome, String(k))); });
  sel.value = !!repertorios[atual].artista === cat ? String(atual) : '';
  sel.setAttribute('aria-label', cat ? 'Artista do catálogo' : 'Meu repertório');
  for (const b of $('palcoFonte').children) b.classList.toggle('on', b.dataset.v === modoFonte);
}
$('palcoFonte').onclick = (e) => { const v = e.target.dataset && e.target.dataset.v; if (!v || v === modoFonte) return; modoFonte = v; montarPalcoRep(); };
function repAtual() { return repertorios[Number($('repSel').value) || 0]; }
function renderMusicas() {
  const r = repAtual();
  for (const [id, vazio] of [['musicaSel', '— escolha a música —'], ['palcoMusica', '— sem música (batidas avulsas) —']]) {
    const sel = $(id);
    sel.innerHTML = '';
    sel.add(new Option(vazio, ''));
    r.musicas.forEach((m, i) => {
      const o = new Option(m.batidaA ? `${i + 1}. ${m.titulo} · ${m.bpm} BPM` : `${i + 1}. ${m.titulo} (sem batida ainda)`, String(i));
      o.disabled = !m.batidaA;
      sel.add(o);
    });
  }
  renderMusicaInfo();
}
function musicaAtual() {
  const r = repAtual();
  const i = r ? r.musicas.findIndex((x) => x.titulo === cfg.musica) : -1;
  return { i, m: i >= 0 ? r.musicas[i] : null };
}
function renderMusicaInfo() {
  const r = repAtual(), { i, m } = musicaAtual();
  for (const id of ['musicaSel', 'palcoMusica']) $(id).value = i >= 0 ? String(i) : '';
  const alterada = m && (cfg.slots.A !== m.batidaA || (cfg.slots.B || null) !== (m.batidaB || null));
  $('stMusica').textContent = m ? `${i + 1}. ${m.titulo}` : 'Sem música escolhida';
  $('stMusica').classList.toggle('vazia', !m);
  $('stMusicaSub').textContent = m
    ? `${m.artista || ''} · ${m.bpm} BPM${m.inicio === 'marcacao' ? ' · começa na marcação' : ''}${alterada ? ' · batida trocada à mão' : ''}`
    : 'toque aqui para escolher do repertório';
  $('stMusicaSub').classList.toggle('alerta', !!alterada);
  let prox = null;
  if (i >= 0) for (let k = i + 1; k < r.musicas.length; k++) if (r.musicas[k].batidaA) { prox = r.musicas[k]; break; }
  $('stProxima').textContent = prox ? `Próxima: ${prox.titulo}${prox.artista && !r.artista ? ' · ' + prox.artista : ''}` : '';
  renderVisorLista(r, i);
  $('musicaInfo').textContent = m
    ? `${m.titulo}${m.artista ? ' (' + m.artista + ')' : ''} · A: ${porId.get(m.batidaA).nome}${m.batidaB ? ' · B: ' + porId.get(m.batidaB).nome : ''} · ${m.bpm} BPM (${m.fonte_bpm})${m.adaptacao ? ' · sem transcrição: adaptação, validar de ouvido' : ''}${m.nota ? ' · ' + m.nota : ''}`
    : `${r.musicas.filter((x) => x.batidaA).length} de ${r.musicas.length} músicas com batida definida.`;
}
// lista do repertório dentro do visor (aparece em tablet e monitor)
function renderVisorLista(r, atual) {
  const ol = $('visorLista');
  $('vlNome').textContent = r.artista || r.nome;
  ol.innerHTML = '';
  r.musicas.forEach((m, k) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'vl-item' + (k === atual ? ' atual' : '');
    b.disabled = !m.batidaA;
    const n = document.createElement('span'); n.className = 'vl-num'; n.textContent = k + 1;
    const t = document.createElement('span'); t.className = 'vl-tit'; t.textContent = m.titulo;
    const v = document.createElement('span'); v.className = 'vl-bpm'; v.textContent = m.batidaA ? m.bpm : '—';
    b.append(n, t, v);
    b.onclick = () => aplicarMusica(k);
    li.append(b); ol.append(li);
  });
  const at = ol.querySelector('.atual');
  if (at && ol.clientHeight) ol.scrollTop = Math.max(0, at.parentElement.offsetTop - ol.clientHeight / 2 + at.offsetHeight / 2);
}
function aplicarMusica(idx) {
  const m = repAtual().musicas[idx];
  if (!m || !m.batidaA) { if (idx === '' || idx == null || Number.isNaN(idx)) { cfg.musica = null; salvar(cfg); renderMusicaInfo(); } return; }
  cfg.musica = m.titulo;
  escolher('A', m.batidaA);
  escolher('B', m.batidaB || '');
  setBpm(m.bpm);
  if (m.inicio) definirInicio(m.inicio);
  renderMusicaInfo();
}
function pularMusica(dir) {
  const ms = repAtual().musicas;
  let i = musicaAtual().i;
  if (i < 0) i = dir > 0 ? -1 : ms.length;
  for (let k = i + dir; k >= 0 && k < ms.length; k += dir) if (ms[k].batidaA) { aplicarMusica(k); return; }
}
function trocarRep(v) {
  $('repSel').value = v;
  modoFonte = repAtual().artista ? 'cat' : 'rep';
  montarPalcoRep();
  cfg.repertorio = repAtual().nome; salvar(cfg); renderMusicas();
}
$('repSel').onchange = (e) => trocarRep(e.target.value);
$('palcoRep').onchange = (e) => { if (e.target.value !== '') trocarRep(e.target.value); };
$('musicaSel').onchange = (e) => aplicarMusica(e.target.value === '' ? null : Number(e.target.value));
$('palcoMusica').onchange = (e) => aplicarMusica(e.target.value === '' ? null : Number(e.target.value));
$('musAnt').onclick = () => pularMusica(-1);
$('musProx').onclick = () => pularMusica(1);

// ---------------------------------------------------------------- busca (artista ou música), estilo Spotify
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tituloCurto = (t) => t.replace(/ – [^–]+$/, ''); // "One – Metallica" → "One" (o artista aparece embaixo)
const alfa = (x, y) => x.localeCompare(y, 'pt-BR', { sensitivity: 'base', numeric: true });
const chaveArt = (a) => a.replace(/^the\s+/i, '');
let indiceBusca = { musicas: [], artistas: [] };
function montarIndiceBusca() {
  const musicas = [], vistas = new Set();
  const artistas = repertorios.map((r, k) => (r.artista ? { k, nome: r.artista, n: r.musicas.filter((m) => m.batidaA).length, total: r.musicas.length } : null)).filter(Boolean);
  // catálogo primeiro (a mesma música nas listas do Bin não aparece duas vezes)
  const ordem = repertorios.map((r, k) => k).sort((a, b) => !!repertorios[b].artista - !!repertorios[a].artista);
  for (const k of ordem) {
    const r = repertorios[k];
    r.musicas.forEach((m, i) => {
      const artista = r.artista || m.artista || '';
      const curto = tituloCurto(m.titulo);
      const chave = semAcento(curto) + '|' + semAcento(artista).slice(0, 5);
      if (vistas.has(chave)) return;
      vistas.add(chave);
      musicas.push({ k, i, titulo: m.titulo, curto, artista, bpm: m.bpm, tem: !!m.batidaA, rep: r.artista ? null : r.nome,
        busca: semAcento(curto + ' ' + m.titulo), buscaArt: semAcento(artista) });
    });
  }
  musicas.sort((a, b) => alfa(a.curto, b.curto));
  indiceBusca = { musicas, artistas };
}
let buscaArtista = null; // índice do repertório do artista aberto na busca
const ICONE_SALVAR = '<svg class="ico-salvar" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 3h13l3 3v15H4z"/><path d="M7 3v6h9V3"/><rect x="7" y="13" width="10" height="8" rx="1"/></svg>';
let buscaAlvo = null;     // id do meu repertório quando a busca está no modo "adicionar músicas"
function abrirBusca(alvo = null) {
  buscaArtista = null;
  buscaAlvo = alvo;
  const r = alvo && meus.find((x) => x.id === alvo);
  $('buscaModo').hidden = !r;
  $('buscaModo').textContent = r ? `Adicionando em: ${r.nome} — toque na música para pôr ou tirar` : '';
  $('buscaFechar').textContent = r ? '‹' : '✕';
  $('buscaTexto').value = '';
  $('buscaTela').hidden = false;
  renderBusca();
  setTimeout(() => $('buscaTexto').focus(), 50);
}
function fecharBusca() {
  $('buscaTela').hidden = true; $('buscaTexto').blur();
  if (buscaAlvo) { const id = buscaAlvo; buscaAlvo = null; abrirEditor(id); }
}
function itemBusca({ ico, tit, sub, dir, classe, acao, mais }) {
  const linha = document.createElement('div');
  linha.className = 'busca-linha';
  linha.setAttribute('role', 'listitem');
  const b = document.createElement('button');
  b.className = 'busca-item ' + (classe || '');
  const i = document.createElement('span'); i.className = 'busca-ico'; i.textContent = ico;
  const c = document.createElement('span'); c.style.minWidth = '0';
  const t = document.createElement('div'); t.className = 'busca-tit'; t.textContent = tit;
  const s2 = document.createElement('div'); s2.className = 'busca-sub'; s2.textContent = sub;
  c.append(t, s2);
  const d = document.createElement('span'); d.className = 'busca-dir'; d.textContent = dir || '';
  b.append(i, c, d);
  b.onclick = acao;
  linha.append(b);
  if (mais) {
    const m = document.createElement('button');
    m.className = 'busca-mais' + (mais.on ? ' on' : '');
    m.innerHTML = mais.html; m.setAttribute('aria-label', mais.rotulo); m.title = mais.rotulo;
    m.onclick = mais.acao;
    linha.append(m);
  }
  return linha;
}
function secaoBusca(txt, id) { const h = document.createElement('div'); h.className = 'busca-sec'; h.textContent = txt; if (id) h.id = id; return h; }
// a música como está no repertório de onde a busca tirou (e o nome da origem, para receber correções depois)
function musicaDaBusca(x) {
  const r = repertorios[x.k], m = r.musicas[x.i];
  return { m, origem: r.meu ? m.origem : r.nome };
}
function itemMusica(x) {
  const atual = cfg.musica === x.titulo && repertorios[x.k] === repAtual();
  const sub = `${x.artista || 'artista não informado'}${x.rep ? ' · ' + x.rep : ''}${x.tem ? '' : ' · sem batida ainda'}`;
  if (buscaAlvo) {
    const alvo = meus.find((r) => r.id === buscaAlvo);
    const { m, origem } = musicaDaBusca(x);
    const ja = alvo && MR.contem(alvo, m);
    return itemBusca({
      ico: ja ? '✓' : '+', tit: x.curto, sub, classe: (ja ? 'incluida' : '') + (x.tem ? '' : ' sem-leve'), dir: x.tem ? `${x.bpm} BPM` : '',
      acao: () => {
        if (!alvo) return;
        if (ja) MR.remover(meus, alvo.id, alvo.musicas.findIndex((y) => y.titulo === m.titulo && (y.artista || '') === (m.artista || '')));
        else MR.adicionar(meus, alvo.id, m, origem);
        gravarMeus(); renderBusca(); aviso2(ja ? `Tirada de ${alvo.nome}` : `Adicionada em ${alvo.nome}`);
      },
    });
  }
  return itemBusca({
    ico: '♪', tit: x.curto, classe: (x.tem ? '' : 'sem') + (atual ? ' atual' : ''), sub,
    dir: x.tem ? `${x.bpm} BPM` : '',
    acao: () => { if (!x.tem) return; trocarRep(String(x.k)); aplicarMusica(x.i); fecharBusca(); },
    mais: { html: ICONE_SALVAR, rotulo: `Salvar ${x.curto} num repertório`, acao: () => abrirEscolha(x) },
  });
}
function itemArtista(a) {
  return itemBusca({ ico: a.nome.replace(/^the\s+/i, '').charAt(0).toUpperCase(), tit: a.nome, classe: 'artista',
    sub: `Artista · ${a.n} de ${a.total} músicas com batida`, dir: '›', acao: () => { buscaArtista = a.k; $('buscaTexto').value = ''; renderBusca(); } });
}
function renderBusca() {
  const res = $('buscaRes'), letras = $('buscaLetras'), q = semAcento($('buscaTexto').value);
  res.innerHTML = ''; letras.innerHTML = '';
  res.scrollTop = 0;
  if (!q && buscaArtista != null) {
    // artista aberto: músicas em ordem alfabética
    const r = repertorios[buscaArtista];
    const volta = document.createElement('button'); volta.className = 'busca-voltar'; volta.textContent = '‹ Todos os artistas';
    volta.onclick = () => { buscaArtista = null; renderBusca(); };
    res.append(volta, secaoBusca(r.artista));
    indiceBusca.musicas.filter((x) => x.k === buscaArtista).forEach((x) => res.append(itemMusica(x)));
    return;
  }
  if (!q) {
    // sem texto: meus repertórios + artistas de A a Z com atalho por letra
    if (!buscaAlvo) res.append(secaoBusca('Meus repertórios'));
    repertorios.forEach((r, k) => { if (!r.artista && !buscaAlvo) res.append(itemBusca({ ico: '☰', tit: r.nome, sub: `${r.musicas.filter((m) => m.batidaA).length} músicas com batida`, dir: '›', acao: () => { trocarRep(String(k)); fecharBusca(); } })); });
    res.append(secaoBusca('Artistas (A–Z)'));
    let letraAnt = '';
    for (const a of indiceBusca.artistas.slice().sort((x, y) => alfa(chaveArt(x.nome), chaveArt(y.nome)))) {
      const l = semAcento(chaveArt(a.nome)).charAt(0).toUpperCase();
      const letra = /[A-Z]/.test(l) ? l : '#';
      if (letra !== letraAnt) {
        const ancora = 'letra-' + letra;
        res.append(secaoBusca(letra, ancora));
        const b = document.createElement('button'); b.textContent = letra;
        b.onclick = () => document.getElementById(ancora).scrollIntoView({ block: 'start' });
        letras.append(b);
        letraAnt = letra;
      }
      res.append(itemArtista(a));
    }
    return;
  }
  // com texto: artistas e músicas que batem (título ou artista), começo da palavra primeiro
  // cada palavra digitada tem que ser começo de palavra no título ou no artista ("one metallica", "zombie")
  const palavras = q.split(' ');
  const bate = (txt) => palavras.every((w) => (' ' + txt).includes(' ' + w));
  const arts = indiceBusca.artistas.filter((a) => bate(semAcento(a.nome))).sort((x, y) => alfa(chaveArt(x.nome), chaveArt(y.nome)));
  const pesoMus = (x) => (x.busca.startsWith(q) ? 3 : bate(x.busca) ? 2 : bate(x.busca + ' ' + x.buscaArt) ? 1 : 0);
  const mus = indiceBusca.musicas.filter((x) => pesoMus(x) > 0).sort((a, b) => pesoMus(b) - pesoMus(a) || alfa(a.curto, b.curto));
  if (arts.length) { res.append(secaoBusca('Artistas')); arts.slice(0, 6).forEach((a) => res.append(itemArtista(a))); }
  if (mus.length) { res.append(secaoBusca(`Músicas (${mus.length})`)); mus.slice(0, 120).forEach((x) => res.append(itemMusica(x))); }
  if (!arts.length && !mus.length) { const v = document.createElement('div'); v.className = 'busca-vazio'; v.textContent = 'Nada encontrado.'; res.append(v); }
}
$('btnBusca').onclick = () => abrirBusca();
$('buscaFechar').onclick = fecharBusca;
$('buscaTexto').oninput = () => { if ($('buscaTexto').value) buscaArtista = null; renderBusca(); };
$('buscaTexto').onkeydown = (e) => {
  if (e.key === 'Escape') fecharBusca();
  if (e.key === 'Enter') { const p = $('buscaRes').querySelector('.busca-item:not(.sem)'); if (p) p.click(); }
};

// aviso curto que some sozinho (por cima de tudo, inclusive das telas de busca/edição)
let toastTimer = null;
function aviso2(txt) { const t = $('toast'); t.textContent = txt; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1800); }

// ---------------------------------------------------------------- "+": escolher em qual repertório pôr a música
let escolhaMus = null;
function abrirEscolha(x) {
  escolhaMus = musicaDaBusca(x);
  $('escolhaTitulo').textContent = `Salvar “${x.curto}” em:`;
  const lista = $('escolhaLista');
  lista.innerHTML = '';
  for (const r of meus) {
    const ja = MR.contem(r, escolhaMus.m);
    const b = document.createElement('button');
    b.className = 'escolha-item' + (ja ? ' on' : '');
    b.textContent = (ja ? '✓ ' : '') + r.nome;
    b.disabled = ja;
    b.onclick = () => { MR.adicionar(meus, r.id, escolhaMus.m, escolhaMus.origem); gravarMeus(); fecharEscolha(); renderBusca(); aviso2(`Adicionada em ${r.nome}`); };
    lista.append(b);
  }
  $('escolhaNome').value = '';
  $('escolhaTela').hidden = false;
}
function fecharEscolha() { $('escolhaTela').hidden = true; escolhaMus = null; }
$('escolhaFechar').onclick = fecharEscolha;
$('escolhaCriar').onclick = () => {
  if (!escolhaMus) return;
  const r = MR.criar(meus, $('escolhaNome').value || 'Novo repertório');
  MR.adicionar(meus, r.id, escolhaMus.m, escolhaMus.origem);
  gravarMeus(); fecharEscolha(); renderBusca(); aviso2(`Criado “${r.nome}” com a música`);
};

// ---------------------------------------------------------------- editar meus repertórios
let editId = null, apagarArmado = null;
function abrirEditor(id) {
  editId = id || (repAtual() && repAtual().meu ? repAtual().id : (meus[0] && meus[0].id)) || null;
  $('editTela').hidden = false;
  renderEditor();
}
function fecharEditor() { $('editTela').hidden = true; $('editNome').blur(); }
function renderEditor() {
  const r = meus.find((x) => x.id === editId);
  const lista = $('editLista');
  lista.innerHTML = '';
  $('editNome').value = r ? r.nome : '';
  $('editNome').disabled = !r;
  $('editAdd').disabled = !r; $('editApagar').disabled = !r; $('editTocar').disabled = !r;
  $('editApagar').textContent = 'Apagar';
  apagarArmado = null;
  // troca rápida entre meus repertórios
  const sel = $('editQual');
  sel.innerHTML = '';
  meus.forEach((x) => sel.add(new Option(x.nome, x.id)));
  sel.value = r ? r.id : '';
  if (!r) { const v = document.createElement('div'); v.className = 'busca-vazio'; v.textContent = 'Nenhum repertório. Toque em “Novo repertório”.'; lista.append(v); return; }
  if (!r.musicas.length) { const v = document.createElement('div'); v.className = 'busca-vazio'; v.textContent = 'Repertório vazio. Toque em “+ Adicionar músicas”.'; lista.append(v); }
  r.musicas.forEach((m, i) => {
    const l = document.createElement('div');
    l.className = 'edit-linha' + (m.batidaA ? '' : ' sem');
    l.setAttribute('role', 'listitem');
    const n = document.createElement('span'); n.className = 'edit-num'; n.textContent = i + 1;
    const c = document.createElement('span'); c.style.minWidth = '0';
    const t = document.createElement('div'); t.className = 'busca-tit'; t.textContent = m.titulo;
    const s2 = document.createElement('div'); s2.className = 'busca-sub'; s2.textContent = `${m.artista || ''}${m.batidaA ? ' · ' + m.bpm + ' BPM' : ' · sem batida ainda'}`;
    c.append(t, s2);
    const bt = (txt, rot, fn, off) => { const b = document.createElement('button'); b.className = 'edit-btn'; b.textContent = txt; b.setAttribute('aria-label', rot); b.disabled = !!off; b.onclick = fn; return b; };
    l.append(n, c,
      bt('▲', `Subir ${m.titulo}`, () => { MR.mover(meus, r.id, i, -1); gravarMeus(); renderEditor(); }, i === 0),
      bt('▼', `Descer ${m.titulo}`, () => { MR.mover(meus, r.id, i, 1); gravarMeus(); renderEditor(); }, i === r.musicas.length - 1),
      bt('✕', `Tirar ${m.titulo}`, () => { MR.remover(meus, r.id, i); gravarMeus(); renderEditor(); aviso2(`Tirada: ${m.titulo}`); }));
    lista.append(l);
  });
}
$('btnEditar').onclick = () => abrirEditor();
// disquete do Palco: salva a música que está carregada agora num dos meus repertórios (ou num novo)
$('btnPor').onclick = () => {
  const { i, m } = musicaAtual();
  if (!m) { aviso2('Escolha uma música primeiro (lista, ◀ ▶ ou Buscar)'); return; }
  abrirEscolha({ k: repertorios.indexOf(repAtual()), i, curto: tituloCurto(m.titulo) });
};
$('editFechar').onclick = fecharEditor;
$('editQual').onchange = (e) => { editId = e.target.value; renderEditor(); };
$('editNome').onchange = () => { const r = MR.renomear(meus, editId, $('editNome').value); if (!r) return; const eraAtual = repAtual() && repAtual().id === editId; gravarMeus(eraAtual ? r.nome : undefined); renderEditor(); };
$('editNome').onkeydown = (e) => { if (e.key === 'Enter') $('editNome').blur(); };
$('editNovo').onclick = () => { const r = MR.criar(meus, 'Novo repertório'); gravarMeus(); editId = r.id; renderEditor(); $('editNome').focus(); $('editNome').select(); };
$('editAdd').onclick = () => { const id = editId; fecharEditor(); abrirBusca(id); };
$('editTocar').onclick = () => { const r = meus.find((x) => x.id === editId); if (!r) return; fecharEditor(); montarRepertorios(r.nome); };
$('editApagar').onclick = () => {
  const r = meus.find((x) => x.id === editId);
  if (!r) return;
  if (apagarArmado !== r.id) { apagarArmado = r.id; $('editApagar').textContent = 'Toque de novo p/ apagar'; setTimeout(() => { if (apagarArmado === r.id) { apagarArmado = null; $('editApagar').textContent = 'Apagar'; } }, 3000); return; }
  const eraAtual = repAtual() && repAtual().id === r.id;
  MR.apagar(meus, r.id);
  gravarMeus(eraAtual ? (meus[0] && meus[0].nome) : undefined);
  editId = meus[0] ? meus[0].id : null;
  renderEditor(); aviso2(`Apagado: ${r.nome}`);
};
$('editExportar').onclick = async () => {
  const txt = MR.exportar(meus), nome = `repertorios-cajon-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    const arq = new File([txt], nome, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [arq] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) { await navigator.share({ files: [arq], title: nome }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
  a.download = nome; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  aviso2(`Arquivo salvo: ${nome}`);
};
$('editImportar').onclick = () => $('editArquivo').click();
$('editArquivo').onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { const n = MR.importar(meus, await f.text()); MR.atualizar(meus, doApp); gravarMeus(); renderEditor(); aviso2(`${n} repertório(s) importado(s)`); }
  catch (err) { aviso2('Não deu para importar: ' + err.message); }
};

function preencherSelects(filtro = '') {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(filtro);
  for (const [slot, id, filtra] of [['A', 'selA', true], ['B', 'selB', true], ['A', 'palcoSelA', false], ['B', 'palcoSelB', false]]) {
    const sel = $(id), atual = cfg.slots[slot];
    sel.innerHTML = '';
    if (slot === 'B') sel.add(new Option('— sem batida B —', ''));
    const grupos = new Map();
    for (const p of biblioteca) {
      const txt = `${p.nome} ${p.variante} ${p.categoria}`;
      if (filtra && q && !norm(txt).includes(q) && p.id !== atual) continue;
      if (!grupos.has(p.categoria)) grupos.set(p.categoria, []);
      grupos.get(p.categoria).push(p);
    }
    for (const [cat, ps] of grupos) {
      const og = document.createElement('optgroup'); og.label = cat || 'Outros';
      for (const p of ps) og.appendChild(new Option(`${p.nome} · ${p.compasso}${p.passos_por_pulso === 3 ? ' tercina' : ''}`, p.id));
      sel.appendChild(og);
    }
    sel.value = atual || '';
  }
}

let verSlot = 'A';
function renderPadrao() {
  const p = porId.get(cfg.slots[verSlot]);
  const info = $('padraoInfo'), grade = $('grade');
  if (!p) { info.textContent = 'Sem batida neste slot.'; grade.textContent = ''; return; }
  const o = p.origem || {};
  info.innerHTML = '';
  const add = (rot, val) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = rot + ': '; d.appendChild(b); d.appendChild(document.createTextNode(val)); info.appendChild(d); };
  add('Padrão', `${p.nome}${p.variante ? ' · ' + p.variante : ''}`);
  add('Grade', `${p.compasso} · ${p.passos_por_pulso} passos por pulso · frase de ${p.compassos} compassos · ${p.bpm} BPM de origem`);
  add('Origem', `${o.tipo}. ${o.detalhe || ''}${o.validar_de_ouvido ? ' Validar de ouvido.' : ''}`);
  for (const n of o.notas_v1 || []) add('Nota', n);
  grade.textContent = Array.from({ length: p.compassos }, (_, i) => `Compasso ${i + 1}\n${gridText(p, i)}`).join('\n\n');
}

function enviarPadroes() {
  for (const slot of ['A', 'B']) {
    const p = porId.get(cfg.slots[slot]);
    engine.send({ type: 'setPattern', slot, pattern: p ? compilePattern(p) : null });
  }
}

function escolher(slot, id) {
  cfg.slots[slot] = id || null;
  const sel = $('sel' + slot);
  if (sel && !Array.from(sel.options).some((o) => o.value === (id || ''))) preencherSelects();
  if (sel) sel.value = id || '';
  if ($('palcoSel' + slot)) $('palcoSel' + slot).value = id || '';
  salvar(cfg);
  if (engine.ready) {
    const p = porId.get(id);
    engine.send({ type: 'setPattern', slot, pattern: p ? compilePattern(p) : null });
    if (p && estado.state === 'stopped' && slot === estado.active) setBpm(p.bpm);
  } else if (slot === 'A' && porId.get(id)) setBpm(porId.get(id).bpm);
  renderSlotsPalco();
  renderPadrao();
}

const escolhaManual = (slot, id) => { escolher(slot, id); if (repertorios.length) renderMusicaInfo(); };
$('selA').onchange = (e) => escolhaManual('A', e.target.value);
$('selB').onchange = (e) => escolhaManual('B', e.target.value);
$('palcoSelA').onchange = (e) => escolhaManual('A', e.target.value);
$('palcoSelB').onchange = (e) => escolhaManual('B', e.target.value);
$('busca').oninput = (e) => preencherSelects(e.target.value);
segmento('verSlot', () => verSlot, (v) => { verSlot = v; renderPadrao(); });


function renderSlotsPalco() {
  const pa = porId.get(cfg.slots[estado.active]);
  if (pa) montarPulsos(pa.pulsos);
  for (const s of ['A', 'B']) {
    const p = porId.get(cfg.slots[s]);
    $('slot' + s + 'Nome').textContent = p ? p.nome : '—';
    $('slot' + s).classList.toggle('ativo', estado.active === s);
    if (estado.state === 'stopped') $('slot' + s).classList.remove('armada');
  }
}

// ---------------------------------------------------------------- BPM
function setBpm(v) {
  cfg.bpm = clampBpm(v);
  $('bpmValor').textContent = Number.isInteger(cfg.bpm) ? cfg.bpm : cfg.bpm.toFixed(1);
  if (engine.ready) engine.send({ type: 'bpm', value: cfg.bpm });
  salvar(cfg);
}
function repetir(btn, fn) {
  let t1, t2;
  const parar = () => { clearTimeout(t1); clearInterval(t2); };
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); t1 = setTimeout(() => { t2 = setInterval(fn, 90); }, 450); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, parar));
}
repetir($('bpmMenos'), () => setBpm(Math.round(cfg.bpm) - 1));
repetir($('bpmMais'), () => setBpm(Math.round(cfg.bpm) + 1));
function fazerTap(t) { const b = tap.tap(t); if (b) setBpm(b); piscar($('btnTap')); }
$('btnTap').addEventListener('pointerdown', (e) => { e.preventDefault(); fazerTap(e.timeStamp); });

// ---------------------------------------------------------------- ligar áudio
async function ligar() {
  if (engine.ready) return;
  if (ligando) return ligando;
  ligando = (async () => {
    $('ligarMsg').textContent = 'Ligando o áudio…';
    try {
      await engine.init();
      $('ligarMsg').textContent = 'Carregando amostras…';
      const kit = await engine.loadKit(cfg.kit);
      engine.send({ type: 'params', params: cfg.params });
      engine.send({ type: 'bpm', value: cfg.bpm });
      enviarPadroes();
      engine.applyMix(cfg.mix);
      renderKit(kit);
      $('ligar').classList.add('oculto');
      tela.pedir();
    } catch (e) {
      console.error(e);
      $('ligarMsg').textContent = 'Não foi possível ligar o áudio:\n' + e.message;
      ligando = null;
    }
  })();
  return ligando;
}
$('btnLigar').onclick = () => ligar();

engine.addEventListener('ctxstate', (e) => {
  if (e.detail !== 'running' && engine.ready) aviso('ctx', `Áudio ${e.detail === 'interrupted' ? 'interrompido' : 'pausado'} pelo sistema.`, { botao: 'RETOMAR', acao: () => engine.resume() });
  else aviso('ctx', null);
});
engine.addEventListener('erro', (e) => aviso('proc', e.detail));
// o motor de som que carregou tem que ser o desta versão (senão o navegador usou um antigo do cache)
engine.addEventListener('ready', () => {
  if (engine.info.motorOk) { aviso('motor', null); return; }
  aviso('motor', `Motor de som desatualizado (${engine.info.motor || 'sem identificação'}). Feche e abra a página de novo.`, { botao: 'RECARREGAR', acao: () => location.reload() });
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && engine.ready) engine.resume().catch(() => {}); });

// ---------------------------------------------------------------- estado vindo do motor
engine.addEventListener('state', (e) => {
  Object.assign(estado, e.detail);
  const s = $('stStatus');
  s.textContent = { stopped: 'PARADO', count: 'CONTAGEM', intro: 'MARCAÇÃO LEVE', playing: estado.hold === 'leve' ? 'MARCAÇÃO LEVE' : estado.hold ? 'SÓ GRAVE' : 'TOCANDO' }[estado.state];
  s.className = 'status ' + (estado.state === 'playing' ? 'tocando' : estado.state === 'count' ? 'contagem' : estado.state === 'intro' ? 'intro' : '');
  $('rotA').textContent = estado.state === 'stopped' ? 'PLAY' : estado.state === 'intro' ? 'ENTRAR BATIDA' : 'PARAR';
  $('rotB').textContent = estado.hold ? 'VOLTAR À BATIDA' : 'SÓ GRAVE · 2× LEVE';
  if (estado.state === 'stopped') { $('stArmado').textContent = ''; limparPulsos(); $('compassoInfo').textContent = '—'; marcarPedais({}); }
  renderSlotsPalco();
  $('btnAtualizar').disabled = estado.state !== 'stopped';
});

let ultimaVirada = -1;
engine.addEventListener('fill', (e) => { ultimaVirada = e.detail.frame; });

engine.addEventListener('beat', (e) => {
  const m = e.detail;
  const quando = engine.frameToPerf(m.frame) - performance.now();
  // mostra o pulso no instante em que ele sai no alto-falante
  setTimeout(() => {
    montarPulsos(m.pulsos);
    const els = $('pulsos').children;
    for (let i = 0; i < els.length; i++) els[i].classList.toggle('aceso', i === m.beat);
    if (m.frame === ultimaVirada) els[m.beat] && els[m.beat].classList.add('virada');
    $('compassoInfo').textContent = m.kind === 'count' ? `${m.pulsos - m.beat}…` : m.kind === 'intro' ? 'pise A' : `${m.phraseBar + 1}/${m.compassos}`;
    const p = m.pend, arm = [];
    if (p.stop) arm.push('PARANDO NO 1');
    if (p.swap) arm.push(`TROCA → ${m.slot === 'A' ? 'B' : 'A'}`);
    if (p.fill) arm.push('VIRADA');
    if (p.hold === 'grave') arm.push('SÓ GRAVE NO 1');
    if (p.hold === 'leve') arm.push('MARCAÇÃO LEVE NO 1');
    if (p.hold === false) arm.push('BATIDA NO 1');
    if (p.bpm != null) arm.push(`${p.bpm} BPM NO 1`);
    if (p.enter) arm.push('ENTRA NO 1');
    $('stArmado').textContent = arm.join(' · ');
    marcarPedais({ A: !!(p.stop || p.enter), B: p.hold === 'grave' || p.hold === 'leve' || p.hold === false, C: !!p.fill, D: !!p.swap });
    for (const s of ['A', 'B']) $('slot' + s).classList.toggle('armada', !!p.swap && s !== m.slot);
    if (m.kind === 'count') $('stStatus').textContent = 'CONTAGEM';
  }, Math.max(0, quando));
});

function montarPulsos(n) {
  const box = $('pulsos');
  if (box.children.length === n) return;
  box.innerHTML = '';
  for (let i = 0; i < n; i++) { const d = document.createElement('div'); d.className = 'pulso' + (i === 0 ? ' um' : ''); d.textContent = i + 1; box.appendChild(d); }
}
function limparPulsos() { for (const d of $('pulsos').children) d.classList.remove('aceso', 'virada'); }

// ---------------------------------------------------------------- pedais
function marcarPedais(armadas) { document.querySelectorAll('.pedal').forEach((b) => b.classList.toggle('armada', !!armadas[b.dataset.letra])); }
function piscar(el) { el.classList.add('pisado'); setTimeout(() => el.classList.remove('pisado'), 120); }

document.querySelectorAll('.pedal').forEach((b) => {
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); pedal.tela(b.dataset.letra, e.timeStamp); });
});

pedal.addEventListener('pedal', async (e) => {
  const { letra } = e.detail;
  const btn = document.querySelector(`.pedal[data-letra="${letra}"]`);
  if (btn) piscar(btn);
  if (lat.ativo) { const a = await lat.pisada(e.detail); if (a) renderLatencia(); return; }
  if (!engine.ready) { await ligar(); return; }
  engine.resume().catch(() => {});
  tela.pedir();
  switch (letra) {
    case 'A': engine.send({ type: 'togglePlay' }); break;
    case 'B': engine.send({ type: 'holdTap' }); break;
    case 'C': engine.send({ type: 'fill' }); break;
    case 'D': engine.send({ type: 'swap' }); break;
    default: break;
  }
});
// teclas fora do mapa: T = tap, Esc = parar já
pedal.addEventListener('tecla', (e) => {
  if (e.detail.code === 'KeyT') fazerTap(e.detail.t);
  if (e.detail.code === 'Escape' && engine.ready) engine.send({ type: 'stopNow' });
});
$('btnPanico').onclick = () => { if (engine.ready) engine.send({ type: 'stopNow' }); };

function renderMapa() {
  const corpo = $('mapaCorpo');
  corpo.innerHTML = '';
  for (const l of LETRAS) {
    const m = cfg.pedal[l] || {};
    const tr = document.createElement('tr');
    const apr = pedal.aprendendo;
    tr.innerHTML = `<td><b>${l}</b></td><td>${ACOES[l]}</td><td></td><td></td>`;
    const celula = (td, tipo, txt) => {
      const s = document.createElement('span'); s.className = 'sinal'; s.textContent = txt || '—'; td.appendChild(s);
      const b = document.createElement('button');
      const ativo = apr && apr.letra === l && apr.tipo === tipo;
      b.textContent = ativo ? 'pise agora…' : 'aprender';
      b.className = ativo ? 'aprendendo' : '';
      b.onclick = () => pedal.aprender(ativo ? null : l, tipo);
      td.appendChild(b);
      if (txt) { const x = document.createElement('button'); x.textContent = 'limpar'; x.onclick = () => pedal.limpar(l, tipo); td.appendChild(x); }
      if (tipo === 'midi' && m.midi) {
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="pisar">só ao pisar</option><option value="qualquer">toda mensagem</option>';
        sel.value = m.midi.modo || 'pisar';
        sel.onchange = () => { m.midi.modo = sel.value; salvar(cfg); };
        sel.style.marginTop = '6px';
        td.appendChild(sel);
      }
    };
    celula(tr.children[2], 'tecla', m.tecla);
    if (pedal.midiSuportado) celula(tr.children[3], 'midi', m.midi && m.midi.sig);
    else tr.children[3].textContent = 'sem Web MIDI';
    corpo.appendChild(tr);
  }
}
pedal.addEventListener('mapa', () => { cfg.pedal = pedal.mapa; salvar(cfg); renderMapa(); });
pedal.addEventListener('aprendendo', renderMapa);
pedal.addEventListener('log', (e) => {
  $('pedalLog').innerHTML = '';
  for (const r of e.detail.slice(0, 12)) { const li = document.createElement('li'); li.textContent = `${r.fonte} · ${r.detalhe} → ${r.letra || 'sem pedal'}`; $('pedalLog').appendChild(li); }
});
pedal.addEventListener('midi', (e) => { $('midiStatus').textContent = e.detail.length ? e.detail.map((i) => `${i.nome} (${i.estado})`).join(', ') : 'nenhum dispositivo MIDI encontrado'; renderMapa(); });
$('btnMidi').onclick = async () => {
  try { await pedal.conectarMidi(); } catch (e) { $('midiStatus').textContent = e.message; }
};
if (!pedal.midiSuportado) { $('btnMidi').disabled = true; $('midiStatus').textContent = 'Este navegador não tem Web MIDI. Use o pedal em modo teclado.'; }

// ---------------------------------------------------------------- groove
function segmento(id, get, set) {
  const box = $(id);
  const sync = () => box.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(get()) === b.dataset.v));
  box.querySelectorAll('button').forEach((b) => { b.onclick = () => { set(b.dataset.v); sync(); }; });
  sync();
  return sync;
}
function enviarParams() { salvar(cfg); if (engine.ready) engine.send({ type: 'params', params: cfg.params }); }
function slider(id, get, set, fmt) {
  const el = $(id), out = $(id + 'Out');
  el.value = get();
  const show = () => { if (out) out.textContent = fmt(Number(el.value)); };
  el.oninput = () => { set(Number(el.value)); show(); };
  show();
}
const P = cfg.params;

// tema da tela: escuro (grafite) ou claro (painel branco)
const TEMA_CHAVE = 'cpp2:tema';
let tema = 'escuro';
try { tema = localStorage.getItem(TEMA_CHAVE) === 'claro' ? 'claro' : 'escuro'; } catch (_) { /* sem armazenamento: fica escuro */ }
function aplicarTema() {
  const claro = tema === 'claro';
  if (claro) document.documentElement.dataset.tema = 'claro'; else delete document.documentElement.dataset.tema;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = claro ? '#e6e8ea' : '#1c1d1f';
}
aplicarTema();
segmento('tema', () => tema, (v) => { tema = v === 'claro' ? 'claro' : 'escuro'; try { localStorage.setItem(TEMA_CHAVE, tema); } catch (_) { /* segue só nesta sessão */ } aplicarTema(); });
slider('swing', () => (P.swing ?? 0.5) * 100, (v) => { P.swing = v / 100; $('swingPadrao').checked = false; enviarParams(); }, (v) => ($('swingPadrao').checked ? 'do padrão' : `${v.toFixed(1)}%`));
$('swingPadrao').checked = P.swing == null;
$('swingPadrao').onchange = (e) => { P.swing = e.target.checked ? null : Number($('swing').value) / 100; $('swingOut').textContent = e.target.checked ? 'do padrão' : `${Number($('swing').value).toFixed(1)}%`; enviarParams(); };
segmento('swingNivel', () => P.swingNivel, (v) => { P.swingNivel = Number(v); enviarParams(); });
slider('humMs', () => P.humanMs, (v) => { P.humanMs = v; enviarParams(); }, (v) => (v ? `até ±${v} ms` : 'desligada'));
slider('humVel', () => P.humanVelPct, (v) => { P.humanVelPct = v; enviarParams(); }, (v) => (v ? `±${v}%` : 'desligada'));
segmento('contagem', () => P.contagemCompassos, (v) => { P.contagemCompassos = Number(v); enviarParams(); });
const syncInicio = segmento('inicio', () => P.inicio || 'contagem', (v) => definirInicio(v));
function definirInicio(v) {
  P.inicio = v === 'marcacao' ? 'marcacao' : 'contagem';
  enviarParams();
  const b = $('btnInicio');
  b.textContent = P.inicio === 'marcacao' ? 'MARCAÇÃO' : 'CONTAGEM';
  b.setAttribute('aria-label', `Como começa: ${P.inicio === 'marcacao' ? 'marcação leve' : 'contagem'}. Toque para trocar.`);
  b.classList.toggle('marcacao', P.inicio === 'marcacao');
  syncInicio && syncInicio();
}
$('btnInicio').onclick = () => definirInicio(P.inicio === 'marcacao' ? 'contagem' : 'marcacao');
definirInicio(P.inicio);
segmento('autoVirada', () => P.autoViradaCada, (v) => { P.autoViradaCada = Number(v); enviarParams(); });
for (const id of ['estiloVirada', 'estiloAuto']) {
  const sel = $(id);
  for (const s of ESTILOS_VIRADA) sel.add(new Option(s, s));
}
$('estiloVirada').value = P.estiloVirada; $('estiloAuto').value = P.estiloAutoVirada;
$('estiloVirada').onchange = (e) => { P.estiloVirada = e.target.value; enviarParams(); };
$('estiloAuto').onchange = (e) => { P.estiloAutoVirada = e.target.value; enviarParams(); };
$('trilhaH').checked = P.trilhas.H; $('trilhaP').checked = P.trilhas.P;
$('trilhaH').onchange = (e) => { P.trilhas.H = e.target.checked; enviarParams(); };
$('trilhaP').onchange = (e) => { P.trilhas.P = e.target.checked; enviarParams(); };

// ---------------------------------------------------------------- som
const M = cfg.mix;
function enviarMix() { salvar(cfg); if (engine.ready) engine.applyMix(M); }
for (const g of Object.keys(GOLPES)) {
  const d = document.createElement('div'); d.className = 'campo';
  d.innerHTML = `<label for="vol${g}">${g} · ${GOLPES[g]} <output id="vol${g}Out"></output></label><input id="vol${g}" type="range" min="0" max="150" step="1">`;
  $('volumes').appendChild(d);
  slider('vol' + g, () => M.volumes[g], (v) => { M.volumes[g] = v; enviarMix(); }, (v) => `${v}%`);
}
const db = (v) => `${v > 0 ? '+' : ''}${v} dB`;
slider('eqGrave', () => M.eq.grave, (v) => { M.eq.grave = v; enviarMix(); }, db);
slider('eqMedio', () => M.eq.medio, (v) => { M.eq.medio = v; enviarMix(); }, db);
slider('eqAgudo', () => M.eq.agudo, (v) => { M.eq.agudo = v; enviarMix(); }, db);
slider('master', () => M.master, (v) => { M.master = v; enviarMix(); }, (v) => `${Math.round(v * 100)}%`);
$('compLigado').checked = M.compLigado; $('limLigado').checked = M.limLigado;
$('compLigado').onchange = (e) => { M.compLigado = e.target.checked; enviarMix(); };
$('limLigado').onchange = (e) => { M.limLigado = e.target.checked; enviarMix(); };

function renderKit(k) {
  const el = $('kitInfo');
  el.innerHTML = '';
  const h = document.createElement('h2'); h.textContent = 'Kit de amostras'; el.appendChild(h);
  const p = document.createElement('p'); p.textContent = `${k.nome} · ${k.amostras} amostras`; el.appendChild(p);
  const o = document.createElement('p'); o.className = 'ajuda'; o.textContent = k.origem; el.appendChild(o);
  for (const t of k.observacoes) { const x = document.createElement('p'); x.className = 'ajuda'; x.textContent = '• ' + t; el.appendChild(x); }
}

// ---------------------------------------------------------------- testes
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
function renderLatencia() {
  const r = lat.resumo(), a = lat.amostras;
  const ultimas = a.slice(-8).map((x) => f1(x.total)).join('  ');
  $('latSaida').textContent = r.n
    ? `Pisadas: ${r.n}\nMédia ${f1(r.media)} ms · mín ${f1(r.min)} · máx ${f1(r.max)} · desvio ${f1(r.dp)}\nInformado pelo navegador: baseLatency ${f1(r.base)} ms · outputLatency ${f1(r.saida)} ms (cada navegador conta de um jeito; não somar)\nÚltimas: ${ultimas}`
    : 'Pise no pedal…';
  $('btnLatCopiar').disabled = !r.n;
}
$('btnLat').onclick = async () => {
  if (!engine.ready) await ligar();
  if (lat.ativo) { lat.parar(); $('btnLat').textContent = 'Iniciar teste'; return; }
  if (estado.state !== 'stopped') { $('latSaida').textContent = 'Pare a música antes do teste.'; return; }
  lat.iniciar(); $('btnLat').textContent = 'Encerrar teste'; renderLatencia();
};
$('btnLatCopiar').onclick = () => copiar(lat.relatorio(engine.latencias()), $('btnLatCopiar'));

let stabMin = 10;
segmento('stabMin', () => stabMin, (v) => { stabMin = Number(v); });
$('btnStab').onclick = async () => {
  if (!engine.ready) await ligar();
  if (stab.rodando) { stab.cancelar(); return; }
  if (estado.state === 'stopped') engine.send({ type: 'play' });
  $('stabSaida').textContent = 'Rodando…';
  $('btnStab').textContent = 'Encerrar agora';
  tela.pedir();
  await stab.iniciar(stabMin);
};
stab.addEventListener('progresso', (e) => { $('stabBarra').style.width = `${Math.min(100, (100 * e.detail.passado) / e.detail.total)}%`; });
stab.addEventListener('fim', (e) => {
  $('stabSaida').textContent = textoEstabilidade(e.detail) + `\nAparelho: ${navigator.userAgent}`;
  $('btnStab').textContent = 'Iniciar';
  $('btnStabCopiar').disabled = false;
  engine.send({ type: 'stop' });
});
$('btnStabCopiar').onclick = () => copiar($('stabSaida').textContent, $('btnStabCopiar'));

async function copiar(txt, btn) {
  try { await navigator.clipboard.writeText(txt); const o = btn.textContent; btn.textContent = 'Copiado ✓'; setTimeout(() => { btn.textContent = o; }, 1500); }
  catch (_) { const w = window.open('', '_blank'); if (w) { w.document.body.innerText = txt; } }
}

// ---------------------------------------------------------------- sistema / offline
// Em alguns ambientes (ex.: página de teste dentro do Claude) o acesso ao service worker é bloqueado.
const swCtl = () => { try { return navigator.serviceWorker ? navigator.serviceWorker.controller : null; } catch (_) { return null; } };
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function renderSistema() {
  const l = engine.latencias();
  $('sisInfo').textContent = [
    `Versão: ${VERSAO}`,
    `Aparelho: ${navigator.userAgent}`,
    `Aberto como app da tela de início: ${standalone() ? 'sim' : 'não (no iOS, a tela acesa só funciona como app instalado)'}`,
    `Tela acesa (Wake Lock): ${tela.estado}`,
    `Sessão de áudio (iOS, chave de silêncio): ${engine.info.audioSession}`,
    `Áudio: ${l.estado} · ${l.sampleRate || '—'} Hz · baseLatency ${l.baseLatency != null ? (l.baseLatency * 1000).toFixed(1) + ' ms' : 'não informado'} · outputLatency ${l.outputLatency != null ? (l.outputLatency * 1000).toFixed(1) + ' ms' : 'não informado'}`,
    `Relógio do AudioWorklet: ${engine.info.globalFrame == null ? '—' : engine.info.globalFrame ? 'currentFrame do navegador' : 'contador próprio'}`,
    `Motor de som: ${engine.info.motor == null ? 'ainda não ligado' : engine.info.motor + (engine.info.motorOk ? ' (atual)' : ` (ANTIGO, esperado ${MOTOR})`)}`,
    `Web MIDI: ${pedal.midiSuportado ? 'disponível' : 'indisponível (use modo teclado)'}`,
    `Service worker: ${swCtl() ? 'ativo (offline)' : 'inativo (normal na página de teste do Claude; no GitHub Pages fica ativo)'}`,
  ].join('\n');
}
tela.addEventListener('estado', (e) => {
  if (e.detail.startsWith('negado') || e.detail === 'sem suporte') aviso('tela', `Tela acesa: ${e.detail}. ${standalone() ? '' : 'Instale o app na tela de início.'}`, { tipo: 'info', botao: 'OK', acao: () => aviso('tela', null) });
  else aviso('tela', null);
});

async function verificarCache() {
  const ctl = swCtl();
  if (!ctl) { $('cacheInfo').textContent = 'Service worker ainda não está controlando a página. Recarregue uma vez com internet.'; return; }
  const ch = new MessageChannel();
  const r = await new Promise((res) => { ch.port1.onmessage = (e) => res(e.data); ctl.postMessage({ type: 'verificar' }, [ch.port2]); });
  $('cacheInfo').textContent = r.faltando.length
    ? `Faltavam ${r.faltando.length} de ${r.total} arquivos; ${r.reparados} recuperados agora.\n${r.faltando.join('\n')}`
    : `Todos os ${r.total} arquivos estão guardados para uso sem internet (versão ${r.versao}).`;
}
$('btnVerificarCache').onclick = verificarCache;

let swOk = false, atualizacaoPedida = false;
try { swOk = 'serviceWorker' in navigator && !!navigator.serviceWorker; } catch (_) { swOk = false; }
if (swOk) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    swReg = reg;
    const oferecer = () => {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      $('btnAtualizar').hidden = false;
      aviso('upd', 'Nova versão pronta. Atualize com a música parada.', { tipo: 'info', botao: 'ATUALIZAR', acao: aplicarAtualizacao });
    };
    oferecer();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') oferecer(); });
    });
  }).catch((e) => console.warn('SW:', e));
  // Só recarrega quando VOCÊ pediu a atualização. Na primeira visita o service worker também
  // assume a página (controllerchange) e não pode recarregar sozinho no meio do uso.
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (atualizacaoPedida && estado.state === 'stopped') { atualizacaoPedida = false; location.reload(); } });
}
function aplicarAtualizacao() {
  if (estado.state !== 'stopped') { aviso('upd', 'Pare a música antes de atualizar.', { tipo: 'info', botao: 'ATUALIZAR', acao: aplicarAtualizacao }); return; }
  if (swReg && swReg.waiting) { atualizacaoPedida = true; swReg.waiting.postMessage({ type: 'skipWaiting' }); }
}
$('btnAtualizar').onclick = aplicarAtualizacao;

// ---------------------------------------------------------------- início
$('bpmValor').textContent = cfg.bpm;
renderMapa();
carregarBiblioteca().catch((e) => aviso('lib', 'Falha ao carregar os padrões: ' + e.message));
window.__cajon = { engine, cfg, estado, pedal, lat, stab }; // depuração
