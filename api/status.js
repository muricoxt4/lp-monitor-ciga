/* Check ao vivo: o dashboard chama este endpoint ao abrir/atualizar
   e o resultado sai direto dos servidores da Vercel — independente
   do GitHub Actions. Sem retry aqui (é consulta, não alerta). */

import { runChecks } from '../lib/checks.js';

export default async function handler(req, res) {
  const result = await runChecks();
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(result);
}
