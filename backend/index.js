import "dotenv/config";

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { calculateOrder, sanitizeSelection } from "./shared/order.js";
import { criarLinkPagamento, verificarPagamento } from "./infinitepay.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Em produção (Render), o frontend já é servido pela Vercel.
// Em dev local, serve o dist/ gerado pelo build do frontend.
const rootDir = path.resolve(__dirname, "..");

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
// Aceita: APP_URL configurado no .env, qualquer subdomínio *.vercel.app e localhost em dev.
const ALLOWED_ORIGINS = new Set(
  [process.env.APP_URL, "http://localhost:5173", "http://localhost:4173"]
    .filter(Boolean)
    .map((o) => o.replace(/\/$/, "")) // remove barra final, se houver
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

    console.log(`[Checkout] Pedido ${orderId} criado em memória. Aguardando confirmação via webhook.`);

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
    const status = paymentData?.status ?? (req.query.status === "concluido" ? "pending" : "unknown");

    const cached = orderCache.get(orderId) || {};

    return res.json({
      orderId,
      verified: paymentData !== null,
      paid,
      status,
      amount: paymentData?.amount ?? cached.totalCents ?? null,
      paid_amount: paymentData?.paid_amount ?? null,
      installments: paymentData?.installments ?? null,
      capture_method: paymentData?.capture_method ?? null,
      receipt_url: req.query.receipt_url || null,
      items: cached.items ?? [],
      totalCents: cached.totalCents ?? null,
      customer: cached.customer ?? null,
    });
  } catch (err) {
    console.error("Erro em GET /api/pedido:", err);
    return res.status(err.status || 500).json({
      error:
        "Não foi possível verificar o status do pedido. Guarde o número do pedido e entre em contato com o suporte.",
    });
  }
});

app.post("/api/webhooks/infinitepay", async (req, res) => {
  // Responde 200 imediatamente — InfinitePay exige resposta rápida
  res.sendStatus(200);

  try {
    const {
      order_nsu: orderId,
      status,
      transaction_nsu,
      invoice_slug,
      capture_method,
      installments
    } = req.body || {};

    console.log(`[Webhook] InfinitePay recebido — orderId: ${orderId} | status: ${status} | método: ${capture_method || "?"} | body: ${JSON.stringify(req.body)}`);

    if (!orderId) {
      console.warn("[Webhook] Notificação sem order_nsu — ignorada.");
      return;
    }

    console.log(`[Webhook] Status recebido para ${orderId}: "${status}"`);

    // Recupera dados do pedido salvos em memória no momento do checkout
    const cached = orderCache.get(orderId);
    if (!cached) {
      console.warn(`[Webhook] Pedido ${orderId} não encontrado no cache em memória. O servidor pode ter reiniciado após o checkout.`);
      return;
    }

    const detail = [
      transaction_nsu && `nsu: ${transaction_nsu}`,
      invoice_slug    && `slug: ${invoice_slug}`
    ].filter(Boolean).join(", ");

    // Escreve na planilha com todos os dados do pedido + detalhes do pagamento
    appendOrderToSheet({
      event:         "Pagamento webhook",
      orderId,
      customer:      cached.customer,
      order:         cached.order,
      status:        status || "webhook",
      captureMethod: capture_method,
      installments:  Number(installments) || 0,
      detail,
    })
      .then(() => console.log(`[Sheets] Pedido ${orderId} registrado na planilha via webhook com status "${resolvePaymentStatus(status)}".`))
      .catch((err) => {
        console.error(`[Sheets] Falha ao registrar pedido ${orderId} via webhook:`, err.message);
        if (err.response?.data) {
          console.error("[Sheets] Detalhe da API Google:", JSON.stringify(err.response.data));
        }
      });

  } catch (err) {
    console.error("[Webhook] Erro ao processar notificação InfinitePay:", err);
  }
});

// frontend/dist quando rodando a partir de backend/ (estrutura reorganizada)
const distDir = path.join(rootDir, "frontend", "dist");
if (process.env.NODE_ENV !== "production") {
  // Em dev local, serve o build do frontend se existir
  app.use(express.static(distDir));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`API AASIAM rodando em http://localhost:${port}`);
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
  status = "",
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
  const statusLabel = resolvePaymentStatus(status);
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

function resolvePaymentStatus(status) {
  const map = {
    approved:   "Pago",
    paid:       "Pago",
    pending:    "Pendente",
    in_process: "Em análise",
    rejected:   "Recusado",
    cancelled:  "Cancelado",
    refunded:   "Reembolsado",
    concluido:  "Pendente",
    unknown:    "Pendente"
  };
  return map[status] || status || "Pendente";
}

function formatDateTime() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function createGoogleAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: getGooglePrivateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

function getGooglePrivateKey() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64) {
    return Buffer.from(
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64,
      "base64"
    ).toString("utf8");
  }
  return process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
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
