/* ==========================================================
   Monitor · LP Revendedores CIGA design
   scripts/run-monitor.js — roda no GitHub Actions a cada 5 min.

   Fluxo:
   1. lê o estado anterior de status-data/ (recuperado da branch
      "status" pelo workflow)
   2. roda os 4 checks (falha só conta depois de 1 retry com 20s
      de espera — oscilação de rede não vira alerta falso)
   3. compara com o estado anterior e decide os avisos Telegram:
        caiu → alerta imediato · segue fora → lembrete a cada 30 min
        voltou → aviso de recuperação com duração da queda
        diário → resumo às 08h (BRT) confirmando que o monitor vive
   4. regrava latest.json / incidents.json / history.json em
      status-data/ (o workflow publica na branch "status", que o
      dashboard lê)
   ========================================================== */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runChecks } from '../lib/checks.js';

const DATA_DIR = 'status-data';
const HISTORY_DAYS = 30;
const REMINDER_MS = 30 * 60 * 1000;
const DAILY_UTC_HOUR = 11; // 08:00 em Brasília

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(`${DATA_DIR}/${file}`, 'utf8'));
  } catch {
    return fallback;
  }
}

function horaBrasil(iso) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso)) + ' (BRT)';
}

function duracao(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

async function telegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('[telegram] secrets ausentes — mensagem não enviada:\n' + text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) console.error('[telegram] falha no envio:', JSON.stringify(json));
}

function listaFalhas(result) {
  return result.checks.filter((c) => !c.ok)
    .map((c) => `• <b>${c.label}</b>: ${c.detail || 'falhou'}`).join('\n');
}

const prev = readJson('latest.json', null);
const incidents = readJson('incidents.json', []);
let history = readJson('history.json', []);

const result = await runChecks({ retryDelayMs: 20000 });
const now = Date.now();
const nowIso = result.timestamp;

console.log(`[monitor] ${nowIso} — ${result.ok ? 'TUDO OK' : 'FALHA'}`);
result.checks.forEach((c) => console.log(`  ${c.ok ? 'ok ' : 'ERRO'} ${c.label} (${c.ms}ms)${c.detail ? ' — ' + c.detail : ''}`));

const state = {
  lastCheck: nowIso,
  ok: result.ok,
  checks: result.checks,
  since: prev && prev.ok === result.ok ? prev.since : nowIso,
  lastAlertAt: prev?.lastAlertAt || null,
  lastDailyAt: prev?.lastDailyAt || null
};

const wasOk = prev ? prev.ok : true;

if (wasOk && !result.ok) {
  // Transição UP → DOWN: abre incidente e alerta na hora
  incidents.unshift({
    start: nowIso,
    end: null,
    failed: result.checks.filter((c) => !c.ok).map((c) => c.label),
    detail: result.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail || 'falhou'}`).join(' · ')
  });
  state.lastAlertAt = nowIso;
  await telegram(
    `🔴 <b>LP REVENDEDORES CIGA — PROBLEMA DETECTADO</b>\n\n${listaFalhas(result)}\n\n` +
    `🕐 ${horaBrasil(nowIso)}\n🔗 https://lp-revendedores-ciga.pages.dev\n\n` +
    `Vou avisar assim que normalizar. Lembretes a cada 30 min enquanto durar.`
  );
} else if (!wasOk && !result.ok) {
  // Continua fora: lembrete a cada 30 min
  if (!state.lastAlertAt || now - new Date(state.lastAlertAt).getTime() >= REMINDER_MS) {
    state.lastAlertAt = nowIso;
    await telegram(
      `🔴 <b>LP ainda com problema</b> (desde ${horaBrasil(state.since)} — ${duracao(now - new Date(state.since).getTime())})\n\n${listaFalhas(result)}`
    );
  }
} else if (!wasOk && result.ok) {
  // Transição DOWN → UP: fecha incidente e comemora
  const inc = incidents.find((i) => !i.end);
  if (inc) inc.end = nowIso;
  const downMs = now - new Date(prev.since).getTime();
  state.lastAlertAt = null;
  await telegram(
    `🟢 <b>LP NORMALIZADA</b>\n\nPágina e formulário respondendo 100% de novo.\n` +
    `⏱ Tempo fora: ${duracao(downMs)}\n🕐 ${horaBrasil(nowIso)}`
  );
}

// Resumo diário às 08h BRT (1x por dia), só quando está tudo em pé
const hojeUtc = nowIso.slice(0, 10);
if (result.ok && new Date().getUTCHours() >= DAILY_UTC_HOUR && state.lastDailyAt !== hojeUtc) {
  state.lastDailyAt = hojeUtc;
  const dia = history.filter((h) => now - new Date(h.t).getTime() < 24 * 3600 * 1000);
  const upPct = dia.length ? ((dia.filter((h) => h.ok).length / dia.length) * 100).toFixed(1) : '100.0';
  await telegram(
    `✅ <b>Resumo diário — LP Revendedores CIGA</b>\n\n` +
    `Página e formulário no ar. Uptime nas últimas 24h: <b>${upPct}%</b> (${dia.length} verificações).\n` +
    `O monitor está ativo — se algo cair, você fica sabendo aqui.`
  );
}

// Histórico: um registro compacto por execução, janela de 30 dias
history.push({
  t: nowIso,
  ok: result.ok,
  f: result.ok ? undefined : result.checks.filter((c) => !c.ok).map((c) => c.id),
  ms: Object.fromEntries(result.checks.map((c) => [c.id, c.ms]))
});
history = history.filter((h) => now - new Date(h.t).getTime() < HISTORY_DAYS * 24 * 3600 * 1000);

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(`${DATA_DIR}/latest.json`, JSON.stringify(state, null, 2));
writeFileSync(`${DATA_DIR}/incidents.json`, JSON.stringify(incidents.slice(0, 200), null, 2));
writeFileSync(`${DATA_DIR}/history.json`, JSON.stringify(history));

console.log('[monitor] estado gravado em status-data/');
