import "dotenv/config";

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { calculateOrder, sanitizeSelection } from "../shared/order.js";
import { criarLinkPagamento } from "./infinitepay.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const app = express();
const port = process.env.PORT || 3333;
const defaultSheetName = process.env.GOOGLE_SHEETS_SHEET_NAME || "Pedidos";

const SHEET_HEADERS = [
  "Data/Hora", "ID Pedido", "Nome", "Telefone",
  "Itens", "Valor Total (R$)", "Pagamento", "Status", "Observações"
];

app.use(express.json({ limit: "1mb" }));

/* ─── HEALTH / CONFIG ─── */

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    infinitePayConfigured: Boolean(process.env.INFINITEPAY_HANDLE),
    googleSheetsConfigured: isGoogleSheetsConfigured(),
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    infinitePayConfigured: Boolean(process.env.INFINITEPAY_HANDLE),
    googleSheetsConfigured: isGoogleSheetsConfigured(),
    googleSheetName: defaultSheetName,
  });
});

/* ─── CHECKOUT ─── */

app.post("/api/checkout", async (req, res) => {
  try {
    const customer = sanitizeCustomer(req.body?.customer);
    const selection = sanitizeSelection(req.body?.selection);
    const order    = calculateOrder(selection);

    // Validações
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

    // Itens: preço em centavos (inteiro), exigido pela InfinitePay
    const items = order.lines.map((line) => ({
      quantity: line.quantity,
      price: line.unitPriceCents,          // já em centavos
      description: line.variant
        ? `${line.productName} - ${line.variant}`
        : line.productName,
    }));

    const { url } = await criarLinkPagamento({
      orderId,
      items,
      cliente: {
        nome: customer.name,
        telefone: customer.phone,
        email: customer.email || undefined,
      },
    });

    // Registra na planilha em background (não bloqueia a resposta)
    appendOrderToSheet({ orderId, customer, order, status: "pending" }).catch((err) =>
      console.error("Erro ao registrar na planilha:", err)
    );

    return res.status(201).json({ orderId, url });
  } catch (err) {
    console.error("Erro em /api/checkout:", err);
    return res.status(err.status || 500).json({
      error: err.message || "Não foi possível criar o link de pagamento.",
    });
  }
});

/* ─── WEBHOOK INFINITEPAY ─── */

app.post("/api/webhooks/infinitepay", async (req, res) => {
  try {
    const { order_nsu: orderId, status, transaction_nsu, invoice_slug } = req.body || {};

    if (!orderId) return res.sendStatus(200);

    const detail = [
      transaction_nsu && `transaction_nsu: ${transaction_nsu}`,
      invoice_slug    && `slug: ${invoice_slug}`,
    ]
      .filter(Boolean)
      .join(", ");

    await appendOrderToSheet({
      orderId,
      customer: { name: "", phone: "" },
      order: { lines: [], totalCents: 0, totalAmount: 0, totalQuantity: 0 },
      status: status || "webhook",
      notes: detail,
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook InfinitePay:", err);
    res.sendStatus(200); // sempre 200 para a InfinitePay não retentar
  }
});

/* ─── STATIC / SPA ─── */

const distDir = path.join(rootDir, "dist");
app.use(express.static(distDir));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(distDir, "index.html")));

app.listen(port, () => {
  console.log(`API AASIAM rodando em http://localhost:${port}`);
  console.log(`  InfinitePay handle : ${process.env.INFINITEPAY_HANDLE || "⚠ não configurado"}`);
  console.log(`  Google Sheets      : ${isGoogleSheetsConfigured() ? "✓ configurado" : "⚠ não configurado"}`);
});

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */

function sanitizeCustomer(customer = {}) {
  return {
    name:  cleanText(customer.name,  120),
    phone: cleanText(customer.phone,  30),
    email: cleanText(customer.email, 120).toLowerCase(),
    notes: cleanText(customer.notes, 500),
  };
}

async function appendOrderToSheet({ orderId, customer, order, status = "", notes = "" }) {
  if (!isGoogleSheetsConfigured()) return { enabled: false };

  const auth   = createGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheetName     = defaultSheetName;

  await ensureSheetExists(sheets, spreadsheetId, sheetName);
  await ensureSheetHeader(sheets, spreadsheetId, sheetName);

  const itemsSummary = order.lines?.length
    ? order.lines.map((l) => l.variant ? `${l.productName} (${l.variant}) x${l.quantity}` : `${l.productName} x${l.quantity}`).join("\n")
    : "";

  const row = [
    formatDateTime(),
    orderId,
    customer.name,
    customer.phone,
    itemsSummary,
    order.totalAmount || "",
    "InfinitePay",
    resolveStatus(status),
    notes || customer.notes || "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:I`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });

  return { enabled: true, status: "appended" };
}

async function ensureSheetExists(sheets, spreadsheetId, sheetName) {
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = data.sheets?.some((s) => s.properties?.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }
}

async function ensureSheetHeader(sheets, spreadsheetId, sheetName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`,
  });
  if (data.values?.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [SHEET_HEADERS] },
  });
}

function resolveStatus(status) {
  const map = {
    pending:    "Pendente",
    paid:       "Pago",
    approved:   "Aprovado",
    rejected:   "Recusado",
    cancelled:  "Cancelado",
    refunded:   "Reembolsado",
    webhook:    "Webhook recebido",
  };
  return map[status] || status || "—";
}

function isGoogleSheetsConfigured() {
  return Boolean(
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
     process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64)
  );
}

function createGoogleAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key:   getGooglePrivateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
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

function formatDateTime() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function createOrderId() {
  const ts     = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AASIAM-${ts}-${suffix}`;
}
