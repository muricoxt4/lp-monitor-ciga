# Monitor · LP Revendedores CIGA design

Monitoramento 24/7 da LP de captação de revendedores (`https://lp-revendedores-ciga.pages.dev`), com alertas no Telegram e dashboard na Vercel.

## O que é verificado (a cada 5 minutos)

| Check | O que valida |
|---|---|
| **Página no ar** | LP responde 200 **e** o HTML contém o formulário (`leadForm`) e o `script.js` |
| **Assets críticos** | `script.js` (com a URL do Apps Script dentro) e `style.css` publicados |
| **Receptor de leads** | GET no `/exec` do Apps Script devolve `{"ok":true}` |
| **Envio do formulário** | POST completo no `/exec` **com o honeypot preenchido** — o Code.gs responde sucesso e descarta antes de gravar. Testa o caminho real do lead **sem sujar a planilha** e sem consumir a cota anti-flood |

Falha só vira alerta depois de 1 retry com 20 s de espera (oscilação de rede não gera alarme falso).

## Arquitetura

- **GitHub Actions** (`.github/workflows/monitor.yml`) — roda os checks a cada 5 min, envia os alertas Telegram e publica o estado na branch `status` (sempre 1 commit, força push; a `main` fica só com código).
- **Branch `status`** — `latest.json` (estado atual), `incidents.json` (histórico de quedas), `history.json` (30 dias de execuções, para o uptime).
- **Vercel** — dashboard (`public/index.html`) + check ao vivo (`api/status.js`), independente do Actions.

## Alertas Telegram

- 🔴 caiu → alerta imediato com o(s) check(s) que falharam
- 🔴 continua fora → lembrete a cada 30 min
- 🟢 voltou → aviso de recuperação com a duração da queda
- ✅ pulso a cada 1 hora confirmando que está tudo no ar (com uptime 24h — também confirma que o próprio monitor está vivo)

Configuração: secrets `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` no repositório (Settings → Secrets and variables → Actions). Sem os secrets, o monitor roda normalmente e só registra a mensagem no log.

## Rodar na mão

```bash
node scripts/run-monitor.js        # roda os checks e grava status-data/
```

Ou dispare o workflow manualmente: Actions → Monitor LP Revendedores → Run workflow.

## Se a LP ou o endpoint mudarem de endereço

Atualizar `LP_URL` / `APPS_SCRIPT_URL` em `lib/checks.js` (e lembrar: republicar o Apps Script gera **nova** URL `/exec` se for uma nova implantação).
