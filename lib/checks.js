/* ==========================================================
   Monitor · LP Revendedores CIGA design
   lib/checks.js — os 4 checks de saúde, compartilhados entre
   o GitHub Actions (scripts/run-monitor.js) e o dashboard
   ao vivo (api/status.js).

   IMPORTANTE: o check do formulário envia POST com o campo
   honeypot ("website") preenchido — o Code.gs identifica como
   bot, responde {ok:true} e DESCARTA antes de gravar qualquer
   linha e antes do contador anti-flood. Nenhum lead falso
   entra na planilha e nenhuma cota é consumida.
   ========================================================== */

export const LP_URL = 'https://lp-revendedores-ciga.pages.dev/';
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzOWBH5vbEjhOIL3m-MhA_pRILThbd39rmqHYtbPAb3G2RCbgYHlwcMeyzHdqJTikRC/exec';

const TIMEOUT_MS = 20000;

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
    return { res, ms: Date.now() - start };
  } catch (err) {
    const ms = Date.now() - start;
    const detail = err.name === 'AbortError' ? `timeout (${TIMEOUT_MS / 1000}s)` : (err.cause?.code || err.message);
    return { res: null, ms, detail };
  } finally {
    clearTimeout(timer);
  }
}

/* A resposta do Apps Script vem depois de um redirect 302 do Google;
   fetch segue o redirect como GET e entrega o JSON final. */
async function fetchAppsScriptJson(options) {
  const { res, ms, detail } = await timedFetch(APPS_SCRIPT_URL, options);
  if (!res) return { ms, error: detail };
  if (!res.ok) return { ms, error: 'HTTP ' + res.status };
  try {
    return { ms, json: await res.json() };
  } catch {
    return { ms, error: 'resposta não é JSON (implantação do Apps Script pode ter mudado)' };
  }
}

async function checkPagina() {
  const { res, ms, detail } = await timedFetch(LP_URL);
  if (!res) return { ok: false, ms, detail };
  if (!res.ok) return { ok: false, ms, detail: 'HTTP ' + res.status };
  const html = await res.text();
  if (!html.includes('id="leadForm"')) return { ok: false, ms, detail: 'página respondeu, mas sem o formulário (leadForm ausente do HTML)' };
  if (!html.includes('script.js')) return { ok: false, ms, detail: 'página respondeu, mas sem o script.js referenciado' };
  return { ok: true, ms };
}

async function checkAssets() {
  const start = Date.now();
  const [js, css] = await Promise.all([
    timedFetch(new URL('script.js', LP_URL).href),
    timedFetch(new URL('style.css', LP_URL).href)
  ]);
  const ms = Date.now() - start;
  if (!js.res || !js.res.ok) return { ok: false, ms, detail: 'script.js: ' + (js.detail || 'HTTP ' + js.res.status) };
  if (!css.res || !css.res.ok) return { ok: false, ms, detail: 'style.css: ' + (css.detail || 'HTTP ' + css.res.status) };
  const jsBody = await js.res.text();
  if (!jsBody.includes('script.google.com')) {
    return { ok: false, ms, detail: 'script.js publicado sem a URL do Apps Script (envio do formulário quebrado)' };
  }
  return { ok: true, ms };
}

async function checkFormGet() {
  const { ms, json, error } = await fetchAppsScriptJson();
  if (error) return { ok: false, ms, detail: error };
  if (json?.ok !== true) return { ok: false, ms, detail: 'endpoint respondeu ' + JSON.stringify(json) };
  return { ok: true, ms };
}

async function checkFormPost() {
  const { ms, json, error } = await fetchAppsScriptJson({
    method: 'POST',
    body: new URLSearchParams({ website: 'monitor-healthcheck', nome: 'monitor' })
  });
  if (error) return { ok: false, ms, detail: error };
  if (json?.ok !== true) return { ok: false, ms, detail: 'POST de teste respondeu ' + JSON.stringify(json) };
  return { ok: true, ms };
}

export const CHECKS = [
  { id: 'pagina', label: 'Página no ar', desc: 'LP responde 200 com o formulário presente', run: checkPagina },
  { id: 'assets', label: 'Assets críticos', desc: 'script.js (com URL de envio) e style.css publicados', run: checkAssets },
  { id: 'form_get', label: 'Receptor de leads', desc: 'Apps Script vivo e respondendo', run: checkFormGet },
  { id: 'form_post', label: 'Envio do formulário', desc: 'POST completo no endpoint (via honeypot, sem gravar lead)', run: checkFormPost }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* retryDelayMs > 0: checks que falharem rodam de novo uma vez após a
   espera, para uma oscilação de rede não virar alerta falso. */
export async function runChecks({ retryDelayMs = 0 } = {}) {
  let results = await Promise.all(CHECKS.map(async (c) => ({ id: c.id, label: c.label, desc: c.desc, ...(await c.run()) })));

  if (retryDelayMs > 0 && results.some((r) => !r.ok)) {
    await sleep(retryDelayMs);
    results = await Promise.all(results.map(async (r) => {
      if (r.ok) return r;
      const check = CHECKS.find((c) => c.id === r.id);
      return { id: check.id, label: check.label, desc: check.desc, ...(await check.run()) };
    }));
  }

  return {
    timestamp: new Date().toISOString(),
    ok: results.every((r) => r.ok),
    checks: results
  };
}
