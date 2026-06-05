import "dotenv/config";

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { calculateOrder, sanitizeSelection } from "../shared/order.js";
import { criarLinkPagamento, verificarPagamento } from "./infinitepay.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const app = express();
const port = process.env.PORT || 3333;
const defaultGoogleSheetName = process.env.GOOGLE_SHEETS_SHEET_NAME || "Pedidos";

const SHEET_HEADERS = [
  "Data/Hora",
  "Evento",
  "ID Pedido",
  "Nome",
  "Telefone",
  "Itens",
  "Tamanho",
  "Quantidade",
  "Total",
  "Pagamento",
  "Status",
  "Detalhe",
  "Observacoes"
];

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
    const orderId = createOrderId();
    const customer = sanitizeCustomer(req.body?.customer);
    const selection = sanitizeSelection(req.body?.selection);
    const order = calculateOrder(selection);

    if (order.lines.length === 0) {
      return res.status(400).json({ error: "Selecione pelo menos um produto." });
    }

    if (!customer.name || !customer.phone) {
      return res.status(400).json({
        error: "Nome e telefone sao obrigatorios para finalizar o pedido."
      });
    }

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

    await appendOrderToSheet({
      event: "Novo pedido",
      orderId,
      customer,
      order,
      status: "pending"
    });

    res.status(201).json({ orderId, url, order });
  } catch (error) {
    console.error("Erro ao criar checkout", error);
    res.status(error.status || 500).json({
      error: error.message || "Nao foi possivel criar o link de pagamento."
    });
  }
});

app.post("/api/webhooks/infinitepay", async (req, res) => {
  try {
    const { order_nsu: orderId, status, transaction_nsu, invoice_slug } = req.body || {};

    if (!orderId) {
      return res.sendStatus(200);
    }

    await appendOrderToSheet({
      event: "Atualizacao webhook",
      orderId,
      customer: { name: "", phone: "" },
      order: { lines: [], totalAmount: 0, totalCents: 0, totalQuantity: 0 },
      status: status || "unknown",
      detail: `transaction_nsu: ${transaction_nsu || ""}, slug: ${invoice_slug || ""}`
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook InfinitePay", error);
    res.sendStatus(200);
  }
});

const distDir = path.join(rootDir, "dist");
app.use(express.static(distDir));

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

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

async function appendOrderToSheet({ event = "Novo pedido", orderId, customer, order, status = "", detail = "" }) {
  if (!isGoogleSheetsConfigured()) {
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

  const row = [
    formatDateTime(),
    event,
    orderId,
    customer.name,
    customer.phone,
    itemSummary.items,
    itemSummary.sizes,
    order.totalQuantity || "",
    order.totalAmount || "",
    "InfinitePay",
    statusLabel,
    detail,
    customer.notes || ""
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:M`,
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
    range: `${quoteSheetName(sheetName)}!A1`
  });

  if (res.data.values?.length) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [SHEET_HEADERS] }
  });
}

function resolvePaymentStatus(status) {
  const map = {
    approved: "Aprovado",
    paid: "Pago",
    pending: "Pendente",
    in_process: "Em análise",
    rejected: "Recusado",
    cancelled: "Cancelado",
    refunded: "Reembolsado",
    unknown: "—"
  };
  return map[status] || status || "—";
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
    items: lines.map((line) => line.productName).join("\n"),
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
