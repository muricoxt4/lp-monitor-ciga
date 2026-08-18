# Monitor · LP Revendedores CIGA design

Monitoramento 24/7 da LP de captação de revendedores, com alertas no Telegram e dashboard na Vercel. Montado em 18/08/2026.

| | |
|---|---|
| **LP monitorada** | https://lp-revendedores-ciga.pages.dev (Cloudflare Pages) |
| **Dashboard** | https://lp-monitor-ciga.vercel.app |
| **Repositório** | https://github.com/muricoxt4/lp-monitor-ciga |
| **Bot Telegram** | @monitorLPCIGA_bot |
| **Backend do formulário** | Google Apps Script → Google Sheets (repo da LP: `muricoxt4/lp-revendedores-ciga`) |

## O que é verificado (a cada 5 minutos)

| Check | O que valida |
|---|---|
| **Página no ar** | LP responde 200 **e** o HTML contém o formulário (`leadForm`) e a referência ao `script.js` — não basta o servidor responder qualquer coisa |
| **Assets críticos** | `script.js` publicado **com a URL do Apps Script dentro** (se sumir, o envio quebra silenciosamente) e `style.css` respondendo |
| **Receptor de leads** | GET no `/exec` do Apps Script devolve `{"ok":true}` |
| **Envio do formulário** | POST real no `/exec` **com o honeypot (`website`) preenchido** — o `Code.gs` identifica como bot, responde sucesso e descarta **antes** de gravar linha e antes do contador anti-flood. Testa o caminho completo do lead **sem sujar a planilha** e sem consumir cota |

Falha só vira alerta depois de 1 retry com 20 s de espera — oscilação de rede não gera alarme falso.

## Alertas no Telegram

- 🔴 **caiu** → alerta imediato dizendo qual(is) check(s) falharam e por quê
- 🔴 **continua fora** → lembrete a cada 30 min com a duração acumulada
- 🟢 **voltou** → aviso de recuperação com o tempo total de queda
- ✅ **pulso horário** → 1 mensagem por hora confirmando que está tudo no ar (com uptime 24h e pior latência). Também serve de prova de vida do próprio monitor. Pausa durante quedas (quem fala são os lembretes)

Credenciais em **Secrets do repositório** (Settings → Secrets and variables → Actions): `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`. Nada fica no código. Sem os secrets, o monitor roda normal e só registra a mensagem no log.

## Dashboard (Vercel)

- **Status ao vivo** — ao abrir (ou clicar em **↻ Atualizar**), o `api/status.js` roda os 4 checks na hora, direto da Vercel — independente do GitHub Actions
- **Uptime** 24h / 7 dias / 30 dias + barras por hora das últimas 24h
- **Incidentes** — cada queda com início, duração e o que falhou
- **Histórico de checks** — as últimas 60 execuções automáticas em tabela
- **Prova de vida** — avisa se o check automático estiver há mais de 20 min sem rodar
- Atualiza sozinho a cada 60 s

## Arquitetura

```
GitHub Actions (cron */5 min) ──▶ scripts/run-monitor.js
     │                                 │
     │ lê/grava estado                 ├─▶ alertas → API do Telegram
     ▼                                 │
branch "status" (sempre 1 commit,      └─▶ latest.json · incidents.json · history.json
força push — main fica só com código)
     ▲
     │ raw.githubusercontent.com (leitura pública)
     │
Dashboard Vercel (public/index.html)
     └─▶ api/status.js — check ao vivo, sob demanda
```

- **`lib/checks.js`** — os 4 checks, compartilhados entre o Actions e o dashboard. As URLs monitoradas ficam no topo deste arquivo.
- **`scripts/run-monitor.js`** — roda no Actions: executa os checks, compara com o estado anterior, decide os avisos Telegram e regrava o estado.
- **`.github/workflows/monitor.yml`** — o agendamento (`*/5 * * * *`) e a publicação do estado na branch `status`.
- **`public/index.html` + `api/status.js`** — o dashboard. Push na `main` → redeploy automático na Vercel (integração Git conectada).
- **`history.json`** guarda 30 dias de execuções; **`incidents.json`** guarda os últimos 200 incidentes.

## Por que GitHub Actions e não tudo na Vercel?

O plano Hobby da Vercel só permite **cron 1x por dia** — inviável para detectar queda em minutos. O Actions roda a cada 5 min de graça, e a branch `status` resolve o armazenamento de estado sem precisar de banco. A Vercel entra onde ela é boa: servir o dashboard e rodar o check ao vivo sob demanda. Se um dia migrar para o plano Pro (cron por minuto) + um storage (Vercel KV/Postgres), dá pra concentrar tudo lá — o `lib/checks.js` é reaproveitável como está.

## Operação

```bash
node scripts/run-monitor.js   # roda os checks na mão (grava ./status-data/)
```

- Disparar o monitor manualmente: GitHub → Actions → *Monitor LP Revendedores* → *Run workflow*
- O agendador do GitHub pode atrasar alguns minutos em horário de pico (check sai a cada 7–10 min) — o dashboard sinaliza se passar de 20 min
- **Se a LP mudar de domínio ou o Apps Script for reimplantado** (nova implantação = nova URL `/exec`): atualizar `LP_URL` / `APPS_SCRIPT_URL` no topo de `lib/checks.js` e dar push — o Actions e o dashboard passam a usar as novas URLs automaticamente
- Se trocar o bot ou o chat do Telegram: atualizar os dois secrets no repositório
