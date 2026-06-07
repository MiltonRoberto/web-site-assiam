// ─── Correção SSL global (Node 18+/OpenSSL 3) ───────────────────────────────
// O OpenSSL 3 rejeita handshake/renegociação TLS legados de alguns servidores,
// surgindo como "error:1E08010C:DECODER routines::unsupported".
// Aplicar SSL_OP_LEGACY_SERVER_CONNECT no agente HTTPS global corrige todas as
// conexões HTTPS do processo (googleapis / Google Sheets, InfinitePay, etc.).
//
// Este módulo é importado em PRIMEIRO lugar no index.js — como os imports ESM
// são executados em ordem, a opção é aplicada antes do googleapis ser carregado.
import https from "node:https";
import { constants } from "node:crypto";

try {
  https.globalAgent.options.secureOptions = constants.SSL_OP_LEGACY_SERVER_CONNECT;
  console.log("[SSL] SSL_OP_LEGACY_SERVER_CONNECT aplicado ao agente HTTPS global.");
} catch (e) {
  console.warn("[SSL] Opção legacy não disponível:", e.message);
}
