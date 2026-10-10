// =============================================
// Service Worker — Locais de Votação RJ
// =============================================

// ⚙️ CONFIGURAÇÕES — edite aqui quando quiser
const VERSAO_CACHE = "v1"; // aumente para "v2", "v3"... quando quiser forçar atualização
const VALIDADE_HORAS = 24; // quantas horas o cache vale antes de tentar atualizar
const DATA_LIMITE = new Date("2026-10-06T23:59:59").getTime(); // depois dessa data, sempre tenta atualizar

const NOME_CACHE = "votacao-" + VERSAO_CACHE;

// Arquivos que serão guardados no cache
const ARQUIVOS_ESTATICOS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./android-chrome-192x192.png",
  "./android-chrome-512x512.png"
];

// URL do CSV (mesma que está no index.html)
const URL_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTiHhCJ23TNCn4WU5_jxUdTYmCSGzWSfGGO8aXGKpGit7aXYC-OJw2C8-YIgPqs5wFvGh0l3qethGrQ/pub?gid=0&single=true&output=csv";

// =============================================
// INSTALAÇÃO — baixa os arquivos essenciais
// =============================================
self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(NOME_CACHE).then((cache) => {
      return cache.addAll(ARQUIVOS_ESTATICOS);
    }).then(() => self.skipWaiting())
  );
});

// =============================================
// ATIVAÇÃO — limpa caches antigos
// =============================================
self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((nomes) => {
      return Promise.all(
        nomes.map((nome) => {
          if (nome !== NOME_CACHE) {
            return caches.delete(nome);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// =============================================
// INTERCEPTA AS REQUISIÇÕES
// =============================================
self.addEventListener("fetch", (evento) => {
  const url = evento.request.url;

  // Se for o CSV da planilha → estratégia especial com validade
  if (url === URL_CSV) {
    evento.respondWith(tratarCSV(evento.request));
    return;
  }

  // Se for arquivo do próprio site (HTML, CSS, imagens)
  if (url.startsWith(self.location.origin)) {
    evento.respondWith(tratarArquivoLocal(evento.request));
    return;
  }

  // Qualquer outra coisa → tenta internet, sem cache
  evento.respondWith(fetch(evento.request).catch(() => caches.match(evento.request)));
});

// =============================================
// CSV: cache com validade (24h / data limite / versão)
// =============================================
async function tratarCSV(request) {
  const cache = await caches.open(NOME_CACHE);
  const cached = await cache.match(request);
  const agora = Date.now();

  // Verifica se o cache está "vencido"
  let vencido = false;

  if (!cached) {
    // Nunca baixou — precisa baixar
    vencido = true;
  } else {
    // Checa data de validade guardada
    const dataGuardada = await cache.match(request.url + "::data");
    if (dataGuardada) {
      const timestamp = parseInt(await dataGuardada.text(), 10);
      const horasPassadas = (agora - timestamp) / (1000 * 60 * 60);
      if (horasPassadas > VALIDADE_HORAS) {
        vencido = true;
      }
    } else {
      vencido = true;
    }
  }

  // Se passou da data limite global, sempre tenta atualizar
  if (agora > DATA_LIMITE) {
    vencido = true;
  }

  // Se não está vencido → devolve o cache na hora (rápido!)
  if (!vencido && cached) {
    return cached;
  }

  // Tenta baixar versão nova
  try {
    const resposta = await fetch(request);
    if (resposta && resposta.ok) {
      // Guarda no cache + guarda a data de agora
      await cache.put(request, resposta.clone());
      await cache.put(request.url + "::data", new Response(String(agora)));
      return resposta;
    }
  } catch (erro) {
    // Falhou (offline?) → usa o cache se tiver
    if (cached) return cached;
    throw erro;
  }

  // Se chegou aqui e tem cache, usa ele
  if (cached) return cached;
  return new Response("Erro ao carregar dados", { status: 503 });
}

// =============================================
// ARQUIVOS LOCAIS: cache-first (rápido e simples)
// =============================================
async function tratarArquivoLocal(request) {
  const cache = await caches.open(NOME_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    // Tem no cache → devolve na hora
    // Mas atualiza em segundo plano (stale-while-revalidate)
    fetch(request).then((resposta) => {
      if (resposta && resposta.ok) {
        cache.put(request, resposta.clone());
      }
    }).catch(() => {});
    return cached;
  }

  // Não tem no cache → busca na internet
  try {
    const resposta = await fetch(request);
    if (resposta && resposta.ok) {
      cache.put(request, resposta.clone());
    }
    return resposta;
  } catch (erro) {
    // Sem internet e sem cache
    return new Response("Offline", { status: 503 });
  }
}
