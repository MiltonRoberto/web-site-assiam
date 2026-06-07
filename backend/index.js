import "dotenv/config";

import express from "express";
import { google } from "googleapis";
import { calculateOrder, sanitizeSelection } from "./shared/order.js";
import { criarLinkPagamento, verificarPagamento } from "./infinitepay.js";

const app = express();
const port = process.env.PORT || 3333;
const defaultGoogleSheetName = process.env.GOOGLE_SHEETS_SHEET_NAME || "Pedidos";

// Cache em memória dos pedidos recentes (orderId → { items, totalCents, customer })
// Suficiente para a sessão atual; o webhook/planilha é a fonte de verdade persistente.
const orderCache = new Map();

// Colunas A-N (14 colunas)
// J=Pagamento (Pix/Cartão), K=Parcelas, L=Status — atualizados pelo webhook
const SHEET_HEADERS = [
  "Data/Hora",   // A
  "Evento",      // B
  "ID Pedido",   // C
  "Nome",        // D
  "Telefone",    // E
  "Itens",       // F
  "Tamanho",     // G
  "Quantidade",  // H
  "Total",       // I
  "Pagamento",   // J — Pix ou Cartão (webhook)
  "Parcelas",    // K — ex: "3x" se cartão (webhook)
  "Status",      // L — Pendente → Pago/Recusado (webhook)
  "Detalhe",     // M
  "Observacoes"  // N
];

/* ─── CORS ─── */
// Aceita: APP_URL do .env (ex: https://loja-aasiam-tkah.vercel.app),
// qualquer *.vercel.app (preview deploys) e localhost em dev.
const ALLOWED_ORIGINS = new Set(
  [process.env.APP_URL, "http://localhost:5173", "http://localhost:4173"]
    .filter(Boolean)
    .map((o) => o.replace(/\/$/, "")) // remove barra final acidental
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed =
    !origin || // chamada server-to-server / mesmo domínio
    ALLOWED_ORIGINS.has(origin) ||
    /^https:\/\/[\w-]+\.vercel\.app$/.test(origin);

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    infinitePayConfigured: Boolean(process.env.INFINITEPAY_HANDLE),
    googleSheetsConfigured: isGoogleSheetsConfigured()
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    infinitePayConfigured: Boolean(process.env.INFINITEPAY_HANDLE),
    googleSheetsConfigured: isGoogleSheetsConfigured(),
    googleSheetName: defaultGoogleSheetName
  });
});

/* ─── TEST SHEETS ─── */
// Rota de diagnóstico — testa autenticação e escrita na planilha em produção.
// Acesse: GET /api/test-sheets
app.get("/api/test-sheets", async (_req, res) => {
  if (!isGoogleSheetsConfigured()) {
    return res.status(500).json({
      ok: false,
      error: "Variáveis de ambiente do Google Sheets não configuradas.",
      vars: {
        GOOGLE_SHEETS_SPREADSHEET_ID: Boolean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID),
        GOOGLE_SERVICE_ACCOUNT_EMAIL:  Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
      }
    });
  }

  try {
    const auth   = createGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const sheetName     = defaultGoogleSheetName;

    // 1. Verifica se a planilha é acessível
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title"
    });
    const abas = meta.data.sheets?.map((s) => s.properties.title) || [];

    // 2. Tenta escrever uma linha de teste
    const timestamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetName}'!A:N`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          timestamp, "TESTE-CONEXAO", "AASIAM-TEST-0000",
          "Sistema", "N/A", "1x Teste", "—", "1", "0.00",
          "Pix", "—", "Teste", "diagnóstico /api/test-sheets", ""
        ]]
      }
    });

    return res.json({
      ok: true,
      message: "Autenticação e escrita na planilha OK.",
      spreadsheetId,
      sheetName,
      abasEncontradas: abas,
      linhaInserida: timestamp
    });
  } catch (err) {
    console.error("[test-sheets] Erro:", err.message, err.response?.data);
    return res.status(500).json({
      ok: false,
      error: err.message,
      detail: err.response?.data || null
    });
  }
});

app.post("/api/checkout", async (req, res) => {
  try {
    const customer = sanitizeCustomer(req.body?.customer);
    const selection = sanitizeSelection(req.body?.selection);
    const order = calculateOrder(selection);

    if (!customer.name) {
      return res.status(400).json({ error: "O campo nome é obrigatório." });
    }

    if (!customer.phone) {
      return res.status(400).json({ error: "O campo telefone é obrigatório." });
    }

    if (order.lines.length === 0) {
      return res.status(400).json({ error: "Selecione pelo menos um produto." });
    }

    const orderId = createOrderId();

    const items = order.lines.map((line) => ({
      quantity: line.quantity,
      price: line.unitPriceCents,
      description: line.variant
        ? `${line.productName} - ${line.variant}`
        : line.productName
    }));

    const { url } = await criarLinkPagamento({
      orderId,
      items,
      cliente: {
        nome: customer.name,
        telefone: customer.phone,
        email: customer.email || undefined
      }
    });

    // Armazena pedido em memória — a planilha só é preenchida após confirmação pelo webhook
    orderCache.set(orderId, {
      items: order.lines.map((line) => ({
        name: line.variant
          ? `${line.productName} - ${line.variant}`
          : line.productName,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      })),
      order,
      customer: { name: customer.name, phone: customer.phone, notes: customer.notes },
      totalCents: order.totalCents,
    });

    console.log(`[Checkout] Pedido ${orderId} criado. Aguardando pagamento.`);

    return res.status(201).json({ orderId, url });
  } catch (err) {
    console.error("Erro em /api/checkout:", err);
    return res.status(err.status || 500).json({
      error: err.message || "Não foi possível criar o link de pagamento."
    });
  }
});

/* ─── CONSULTA DE PEDIDO ─── */

app.get("/api/pedido/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { transaction_nsu, slug } = req.query;

    if (!orderId) {
      return res.status(400).json({ error: "orderId é obrigatório." });
    }

    let paymentData = null;

    if (transaction_nsu && slug) {
      try {
        paymentData = await verificarPagamento({
          orderId,
          transactionNsu: transaction_nsu,
          slug,
        });
      } catch (err) {
        console.error("Erro ao verificar pagamento na InfinitePay:", err.message);
        // Não propaga — retorna o que temos com verified: false
      }
    }

    const paid = paymentData?.paid === true;
    const status = paymentData?.status ?? (req.query.status === "concluido" ? "concluido" : "unknown");

    const cached = orderCache.get(orderId) || {};

    // capture_method e transaction_id vêm da URL de redirect da InfinitePay como fallback
    const captureMethod = paymentData?.capture_method ?? req.query.capture_method ?? null;

    return res.json({
      orderId,
      verified: paymentData !== null,
      paid,
      status,
      amount:         paymentData?.amount      ?? cached.totalCents ?? null,
      paid_amount:    paymentData?.paid_amount  ?? null,
      installments:   paymentData?.installments ?? null,
      capture_method: captureMethod,
      receipt_url:    req.query.receipt_url     || null,
      items:          cached.items    ?? [],
      totalCents:     cached.totalCents ?? null,
      customer:       cached.customer  ?? null,
    });
  } catch (err) {
    console.error("Erro em GET /api/pedido:", err);
    return res.status(err.status || 500).json({
      error:
        "Não foi possível verificar o status do pedido. Guarde o número do pedido e entre em contato com o suporte.",
    });
  }
});

/* ─── VERIFICAÇÃO ATIVA DE STATUS (polling do frontend) ─── */
// Consulta o status atual diretamente na InfinitePay (payment_check).
// Usada pelo frontend a cada 5s para atualizar a tela sem depender só do webhook.
app.get("/api/pedido/:orderId/status", async (req, res) => {
  const { orderId } = req.params;
  const { transaction_nsu, slug } = req.query;

  try {
    let paymentData = null;

    if (transaction_nsu && slug) {
      try {
        paymentData = await verificarPagamento({
          orderId,
          transactionNsu: transaction_nsu,
          slug,
        });
      } catch (err) {
        console.error(`[Status] Erro ao verificar ${orderId} na InfinitePay:`, err.message);
      }
    }

    const rawStatus  = paymentData?.status ?? (paymentData?.paid ? "paid" : "pending");
    const statusLabel = normalizeWebhookStatus(rawStatus);
    const paid = paymentData?.paid === true || statusLabel === "Pago";

    return res.json({
      orderId,
      paid,
      status: statusLabel,          // "Pago" | "Recusado" | "Em análise"
      rawStatus,
      capture_method: paymentData?.capture_method ?? req.query.capture_method ?? null,
      installments:   paymentData?.installments   ?? null,
      verified:       paymentData !== null,
    });
  } catch (err) {
    console.error(`[Status] Erro em GET /api/pedido/${orderId}/status:`, err);
    return res.status(500).json({ error: "Não foi possível verificar o status do pedido." });
  }
});

app.post("/api/webhooks/infinitepay", async (req, res) => {
  // Responde 200 imediatamente — InfinitePay exige resposta rápida
  res.sendStatus(200);

  try {
    const body = req.body || {};
    console.log("[Webhook] Body completo:", JSON.stringify(body));

    // O orderId pode vir em campos diferentes dependendo da configuração InfinitePay
    const orderId =
      body.order_nsu ||
      body.order_id ||
      body.external_reference ||
      body.metadata?.order_id ||
      body.metadata?.orderId ||
      body.metadata?.order_nsu ||
      null;

    // O status pode vir em status, payment_status ou transaction_status
    const rawStatus =
      body.status || body.payment_status || body.transaction_status || "";

    console.log(`[Webhook] orderId: ${orderId} | status: ${rawStatus}`);

    if (!orderId) {
      console.warn("[Webhook] Não foi possível identificar o orderId no payload — ignorado.");
      return;
    }

    const statusLabel = normalizeWebhookStatus(rawStatus);

    // Só grava na planilha em estados terminais (Pago/Recusado).
    // Eventos intermediários (QR gerado, aguardando pagamento) NÃO geram linha.
    if (statusLabel !== "Pago" && statusLabel !== "Recusado") {
      console.log(`[Webhook] Status "${rawStatus}" → "${statusLabel}" não é terminal. Planilha não será preenchida ainda.`);
      return;
    }

    // Idempotência: evita gravar a mesma confirmação duas vezes (InfinitePay reenvia webhooks)
    const cached = orderCache.get(orderId);
    if (cached?.written) {
      console.log(`[Webhook] Pedido ${orderId} já registrado anteriormente — ignorando reenvio.`);
      return;
    }

    // Dados de pagamento (com fallback de nomes de campo)
    const captureMethod  = body.capture_method || body.payment_method || "";
    const installments   = Number(body.installments) || 0;
    const transactionNsu = body.transaction_nsu || body.transaction_id || "";
    const invoiceSlug    = body.invoice_slug || body.slug || "";
    const amountCents    = Number(body.paid_amount ?? body.amount) || 0;

    const detail = [
      transactionNsu && `nsu: ${transactionNsu}`,
      invoiceSlug    && `slug: ${invoiceSlug}`,
      !cached        && "cache indisponível (dados parciais)"
    ].filter(Boolean).join(", ");

    // Se o cache foi perdido (ex: reinício do Render), grava com os dados disponíveis no webhook
    const customer = cached?.customer || { name: "", phone: "", notes: "" };
    const order    = cached?.order || {
      lines: [],
      totalAmount: amountCents ? amountCents / 100 : "",
      totalQuantity: ""
    };

    console.log(`[Sheets] Escrevendo pedido ${orderId} com status ${statusLabel}`);

    try {
      await appendOrderToSheet({
        event: "Pagamento webhook",
        orderId,
        customer,
        order,
        statusLabel,
        captureMethod,
        installments,
        detail,
      });
      console.log(`[Sheets] Sucesso ao escrever pedido ${orderId}`);
      // Marca como gravado para idempotência (se o cache existir)
      if (cached) cached.written = true;
    } catch (err) {
      console.error(`[Sheets] ERRO ao escrever pedido ${orderId}: ${err.message}`);
      if (err.response?.data) {
        console.error("[Sheets] Detalhe da API Google:", JSON.stringify(err.response.data));
      }
    }
  } catch (err) {
    console.error("[Webhook] Erro ao processar notificação InfinitePay:", err);
  }
});

// Em produção o frontend é servido pela Vercel — o backend é apenas a API.
// Em dev local o frontend é servido pelo Vite (porta 5173).
// Não há catch-all aqui para não interferir com rotas /api/*.

app.listen(port, () => {
  console.log(`\n=== API AASIAM iniciada na porta ${port} ===`);
  console.log(`APP_URL : ${process.env.APP_URL  || "⚠ não definido (fallback localhost)"}`);
  console.log(`API_URL : ${process.env.API_URL  || "⚠ não definido (fallback localhost)"}`);
  console.log(`CORS    : ${[...ALLOWED_ORIGINS].join(", ")} + *.vercel.app`);
  console.log(`InfinitePay handle: ${process.env.INFINITEPAY_HANDLE || "⚠ NÃO CONFIGURADO"}`);

  // Diagnóstico do Google Sheets
  const sheetsOk = isGoogleSheetsConfigured();
  console.log(`Google Sheets configurado: ${sheetsOk ? "✓ SIM" : "✗ NÃO"}`);
  if (sheetsOk) {
    const key = getGooglePrivateKey();
    console.log(`  → email : ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
    console.log(`  → key   : ${key ? `${key.slice(0, 27).replace(/\n/g, "↵")}... (${key.length} chars)` : "VAZIA"}`);
    console.log(`  → sheet : ${process.env.GOOGLE_SHEETS_SPREADSHEET_ID} / aba "${defaultGoogleSheetName}"`);
    console.log(`  → teste : GET /api/test-sheets`);
  }
  console.log("=".repeat(45) + "\n");
});

function sanitizeCustomer(customer = {}) {
  return {
    name: cleanText(customer.name, 120),
    phone: cleanText(customer.phone, 30),
    email: cleanText(customer.email, 120).toLowerCase(),
    notes: cleanText(customer.notes, 500)
  };
}

async function appendOrderToSheet({
  event = "Pagamento webhook",
  orderId,
  customer,
  order,
  statusLabel = "Em análise",
  captureMethod = "",
  installments = 0,
  detail = "",
}) {
  if (!isGoogleSheetsConfigured()) {
    console.warn("[Sheets] Integração com Google Sheets não configurada — pulando registro.");
    return { enabled: false, status: "not_configured" };
  }

  const auth = createGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheetName = defaultGoogleSheetName;

  await ensureSheetExists(sheets, spreadsheetId, sheetName);
  await ensureSheetHeader(sheets, spreadsheetId, sheetName);

  const itemSummary = summarizeOrderLines(order.lines || []);
  const pagamento   = resolveCaptureMethod(captureMethod);
  const parcelas    = captureMethod === "pix"
    ? "—"
    : installments > 1 ? `${installments}x` : (captureMethod ? "1x" : "");

  // 14 colunas A-N — todas preenchidas em uma única linha pelo webhook
  const row = [
    formatDateTime(),          // A — Data/Hora da confirmação
    event,                     // B — Evento
    orderId,                   // C — ID Pedido
    customer.name  || "",      // D — Nome
    customer.phone || "",      // E — Telefone
    itemSummary.items,         // F — Itens (ex: "1x Moletom Verde\n2x Caneca")
    itemSummary.sizes,         // G — Tamanho/variante
    order.totalQuantity || "", // H — Quantidade total
    order.totalAmount   || "", // I — Total (reais)
    pagamento,                 // J — Pix / Cartão / Débito
    parcelas,                  // K — Parcelas (ex: "3x" ou "—" para Pix)
    statusLabel,               // L — Pago / Pendente / Recusado etc.
    detail,                    // M — nsu, slug
    customer.notes || ""       // N — Observações do comprador
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:N`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] }
  });

  return { enabled: true, status: "appended", sheetName };
}

async function ensureSheetExists(sheets, spreadsheetId, sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title"
  });

  const hasSheet = spreadsheet.data.sheets?.some(
    (sheet) => sheet.properties?.title === sheetName
  );

  if (hasSheet) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    }
  });
}

async function ensureSheetHeader(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1:N1`
  });

  const currentHeaders = res.data.values?.[0] || [];

  // Grava/atualiza o cabeçalho se estiver ausente ou desatualizado (ex: migração de 13 → 14 colunas)
  const needsUpdate =
    currentHeaders.length === 0 ||
    currentHeaders.length !== SHEET_HEADERS.length ||
    !SHEET_HEADERS.every((h, i) => currentHeaders[i] === h);

  if (!needsUpdate) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [SHEET_HEADERS] }
  });
  console.log("[Sheets] Cabeçalho da planilha atualizado.");
}

function resolveCaptureMethod(method) {
  const map = {
    pix:         "Pix",
    credit_card: "Cartão",
    debit_card:  "Débito"
  };
  return map[method] || method || "";
}

/**
 * Normaliza o status cru do webhook/payment_check da InfinitePay para um rótulo da planilha.
 *  - approved / paid / captured / success → "Pago"
 *  - refused / failed / cancelled / rejected → "Recusado"
 *  - qualquer outro (pending, waiting, created…) → "Em análise"
 */
function normalizeWebhookStatus(status) {
  const s = String(status || "").toLowerCase().trim();

  const pagos     = ["approved", "paid", "captured", "success", "succeeded", "concluido", "concluído", "completed"];
  const recusados = ["refused", "failed", "cancelled", "canceled", "rejected", "denied", "chargeback", "refunded", "expired"];

  if (pagos.includes(s))     return "Pago";
  if (recusados.includes(s)) return "Recusado";
  return "Em análise";
}

function formatDateTime() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function createGoogleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = getGooglePrivateKey();

  // Logs de diagnóstico — nunca expõe a chave completa
  console.log(`[Google Auth] email configurado: ${email ? `${email.slice(0, 20)}...` : "NÃO DEFINIDO"}`);
  console.log(`[Google Auth] private key: ${key
    ? `${key.slice(0, 27).replace(/\n/g, "↵")}... (${key.length} chars, começa com BEGIN: ${key.includes("BEGIN PRIVATE KEY")})`
    : "NÃO DEFINIDA"}`);

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

function getGooglePrivateKey() {
  // Alternativa Base64 (mais segura para painel de hosting)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64) {
    return Buffer.from(
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64,
      "base64"
    ).toString("utf8");
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";

  // Normaliza os três formatos possíveis dependendo do ambiente:
  //  1. Render UI: cole a chave com newlines reais → já tem \n reais, replace é no-op
  //  2. .env local dotenv v17+: \n já convertido para newline real → idem
  //  3. .env local dotenv antigo / var exportada manualmente: \n como backslash-n literal
  return raw
    .replace(/\\n/g, "\n")   // backslash-n literal → newline real
    .trim();
}

function isGoogleSheetsConfigured() {
  return Boolean(
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
        process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64)
  );
}

function summarizeOrderLines(lines) {
  if (!lines.length) return { items: "", sizes: "" };
  return {
    items: lines.map((line) => `${line.quantity}x ${line.productName}`).join("\n"),
    sizes: lines.map(formatSizeForSheet).join("\n")
  };
}

function formatSizeForSheet(line) {
  if (!line.variant) return "—";
  const sizeMatch = line.variant.match(/Tam\.\s*([A-Z0-9]+)/i);
  if (sizeMatch) return sizeMatch[1];
  return line.variant;
}

function cleanText(value, maxLength) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function quoteSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

function createOrderId() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AASIAM-${timestamp}-${suffix}`;
}
