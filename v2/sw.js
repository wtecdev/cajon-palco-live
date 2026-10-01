// Service worker do Cajón Palco Pro (v2).
// Guarda todos os arquivos na instalação para funcionar sem internet no palco.
// VERSAO e ARQUIVOS são preenchidos por tools/build.mjs — não editar à mão.

const VERSAO = '2.0.0-e1+a7b0a0da20';
const ARQUIVOS = [
  "./",
  "./css/app.css",
  "./css/assets/archivo.woff2",
  "./css/assets/dseg7.woff2",
  "./css/assets/madeira-h.jpg",
  "./css/assets/madeira-v.jpg",
  "./css/assets/ruido.png",
  "./data/kits/v1-kit3/hihatClosed.wav",
  "./data/kits/v1-kit3/kit.json",
  "./data/kits/v1-kit3/kit3_bumbo11.wav",
  "./data/kits/v1-kit3/kit3_caixa_aguda_A.wav",
  "./data/kits/v1-kit3/kit3_caixa_aguda_B.wav",
  "./data/kits/v1-kit3/kit3_caixa_reaper.wav",
  "./data/kits/v1-kit3/kit3_caixa_spki.wav",
  "./data/kits/v1-kit3/kit3_ghost_1.wav",
  "./data/kits/v1-kit3/kit3_ghost_2.wav",
  "./data/kits/v1-kit3/kit3_ghost_3.wav",
  "./data/kits/v1-kit3/kit3_ghost_4.wav",
  "./data/kits/v1-kit3/kit3_ghost_5.wav",
  "./data/kits/v1-kit3/kit3_ghost_6.wav",
  "./data/kits/v1-kit3/tambAccent.wav",
  "./data/kits/v1-kit3/tambDown.wav",
  "./data/kits/v1-kit3/tambUp.wav",
  "./data/patterns/batidas.json",
  "./data/setlists/catalogo-3-doors-down.json",
  "./data/setlists/catalogo-ac-dc.json",
  "./data/setlists/catalogo-aerosmith.json",
  "./data/setlists/catalogo-barao-vermelho.json",
  "./data/setlists/catalogo-biquini-cavadao.json",
  "./data/setlists/catalogo-bon-jovi.json",
  "./data/setlists/catalogo-capital-inicial.json",
  "./data/setlists/catalogo-cazuza.json",
  "./data/setlists/catalogo-charlie-brown-jr.json",
  "./data/setlists/catalogo-cidade-negra.json",
  "./data/setlists/catalogo-coldplay.json",
  "./data/setlists/catalogo-creed.json",
  "./data/setlists/catalogo-creedence-clearwater-revival.json",
  "./data/setlists/catalogo-deep-purple.json",
  "./data/setlists/catalogo-dire-straits.json",
  "./data/setlists/catalogo-eagles.json",
  "./data/setlists/catalogo-engenheiros-do-hawaii.json",
  "./data/setlists/catalogo-evanescence.json",
  "./data/setlists/catalogo-foo-fighters.json",
  "./data/setlists/catalogo-goo-goo-dolls.json",
  "./data/setlists/catalogo-green-day.json",
  "./data/setlists/catalogo-guns-n-roses.json",
  "./data/setlists/catalogo-ira.json",
  "./data/setlists/catalogo-jota-quest.json",
  "./data/setlists/catalogo-kid-abelha.json",
  "./data/setlists/catalogo-led-zeppelin.json",
  "./data/setlists/catalogo-legiao-urbana.json",
  "./data/setlists/catalogo-linkin-park.json",
  "./data/setlists/catalogo-lulu-santos.json",
  "./data/setlists/catalogo-lynyrd-skynyrd.json",
  "./data/setlists/catalogo-metallica.json",
  "./data/setlists/catalogo-nando-reis.json",
  "./data/setlists/catalogo-nickelback.json",
  "./data/setlists/catalogo-nirvana.json",
  "./data/setlists/catalogo-o-rappa.json",
  "./data/setlists/catalogo-oasis.json",
  "./data/setlists/catalogo-os-paralamas-do-sucesso.json",
  "./data/setlists/catalogo-pearl-jam.json",
  "./data/setlists/catalogo-pink-floyd.json",
  "./data/setlists/catalogo-queen.json",
  "./data/setlists/catalogo-radiohead.json",
  "./data/setlists/catalogo-raul-seixas.json",
  "./data/setlists/catalogo-red-hot-chili-peppers.json",
  "./data/setlists/catalogo-scorpions.json",
  "./data/setlists/catalogo-skank.json",
  "./data/setlists/catalogo-the-beatles.json",
  "./data/setlists/catalogo-the-cranberries.json",
  "./data/setlists/catalogo-the-doors.json",
  "./data/setlists/catalogo-the-rolling-stones.json",
  "./data/setlists/catalogo-tim-maia.json",
  "./data/setlists/catalogo-titas.json",
  "./data/setlists/catalogo-u2.json",
  "./data/setlists/catalogo-ze-ramalho.json",
  "./data/setlists/index.json",
  "./data/setlists/lista-charlie-brown.json",
  "./data/setlists/lista-pop-rock-bar.json",
  "./data/setlists/lista-raul-legiao.json",
  "./data/setlists/repertorios.json",
  "./data/setlists/the-grunge-geral.json",
  "./data/setlists/the-house.json",
  "./data/setlists/tio-jones-e-bin.json",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./index.html",
  "./js/app.js",
  "./js/core/constants.js",
  "./js/core/fills.js",
  "./js/core/pattern.js",
  "./js/core/rng.js",
  "./js/core/sampler.js",
  "./js/core/sequencer.js",
  "./js/core/tap.js",
  "./js/engine.js",
  "./js/input.js",
  "./js/meus-repertorios.js",
  "./js/storage.js",
  "./js/testes.js",
  "./js/wakelock.js",
  "./js/worklet/cajon-processor.js",
  "./manifest.webmanifest",
  "./js/versao.js"
];
const PREFIXO = 'cpp2-';
const CACHE = PREFIXO + VERSAO;

self.addEventListener('install', (event) => {
  // Sem skipWaiting automático: a nova versão só assume quando o músico manda (com a música parada).
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Só apaga caches DESTE app. O cache da v1 (mesmo domínio) fica intacto.
    for (const k of await caches.keys()) if (k.startsWith(PREFIXO) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const m = event.data || {};
  if (m.type === 'skipWaiting') self.skipWaiting();
  if (m.type === 'verificar') event.waitUntil(verificar(event.ports[0]));
});

// Confere se todos os arquivos estão no cache e recupera os que faltarem (se houver internet).
// Protege contra outro service worker do mesmo domínio que apague caches alheios.
async function verificar(port) {
  const c = await caches.open(CACHE);
  const faltando = [];
  for (const a of ARQUIVOS) if (!(await c.match(a))) faltando.push(a);
  let reparados = 0;
  for (const a of faltando) { try { await c.add(a); reparados++; } catch (_) {} }
  port.postMessage({ versao: VERSAO, total: ARQUIVOS.length, faltando, reparados });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // auto-reparo: se um arquivo do app sumiu do cache, guarda de novo
      if (res.ok && url.pathname.startsWith(new URL('./', self.location).pathname)) c.put(req, res.clone());
      return res;
    } catch (e) {
      if (req.mode === 'navigate') { const idx = await c.match('./index.html'); if (idx) return idx; }
      throw e;
    }
  })());
});
