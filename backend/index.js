import "dotenv/config";

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { calculateOrder, sanitizeSelection } from "../shared/order.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const app = express();
const port = process.env.PORT || 3333;
const mercadoPagoAccessToken = process.env.MP_ACCESS_TOKEN;

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mercadoPagoConfigured: Boolean(mercadoPagoAccessToken),
    googleSheetsConfigured: isGoogleSheetsConfigured()
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    mercadoPagoConfigured: Boolean(mercadoPagoAccessToken),
    googleSheetsConfigured: isGoogleSheetsConfigured(),
    googleSheetName: process.env.GOOGLE_SHEETS_SHEET_NAME || "Pedidos"
  });
});

app.post("/api/payments", async (req, res) => {
  try {
    const orderId = createOrderId();
    const customer = sanitizeCustomer(req.body?.customer);
    const selection = sanitizeSelection(req.body?.selection);
    const order = calculateOrder(selection);

    if (order.lines.length === 0) {
      return res.status(400).json({ error: "Selecione pelo menos um produto." });
    }

    if (!customer.name || !customer.phone || !customer.email) {
      return res.status(400).json({
        error: "Nome, telefone e e-mail sao obrigatorios para finalizar o pedido."
      });
    }

    const paymentRequest = buildMercadoPagoPaymentRequest({
      orderId,
      order,
      customer,
      payment: req.body?.payment
    });

    const payment = mercadoPagoAccessToken
      ? await createMercadoPagoPayment(paymentRequest, orderId)
      : createSimulatedPayment(paymentRequest, orderId);

    const sheetResult = await appendOrderToSheet({ orderId, customer, order, payment });

    res.status(201).json({
      orderId,
      order,
      payment,
      sheet: sheetResult,
      mode: mercadoPagoAccessToken ? "mercado_pago" : "simulado"
    });
  } catch (error) {
    console.error("Erro ao criar pagamento", error);
    res.status(error.status || 500).json({
      error: error.message || "Nao foi possivel criar o pagamento."
    });
  }
});

app.post("/api/webhooks/mercado-pago", async (req, res) => {
  try {
    const paymentId =
      req.body?.data?.id ||
      req.body?.id ||
      req.query?.["data.id"] ||
      req.query?.id;

    if (!paymentId || !mercadoPagoAccessToken) {
      return res.sendStatus(200);
    }

    const payment = await getMercadoPagoPayment(paymentId);

    await appendOrderToSheet({
      orderId: payment.external_reference || "",
      customer: {
        name: payment.metadata?.customer_name || "",
        phone: payment.metadata?.customer_phone || ""
      },
      order: {
        lines: [],
        totalAmount: payment.transaction_amount || 0,
        totalCents: Math.round((payment.transaction_amount || 0) * 100),
        totalQuantity: 0
      },
      payment
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook do Mercado Pago", error);
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
    course: cleanText(customer.course, 120),
    delivery: cleanText(customer.delivery, 120),
    notes: cleanText(customer.notes, 500)
  };
}

function buildMercadoPagoPaymentRequest({ orderId, order, customer, payment }) {
  const formData = payment?.formData || {};
  const selectedPaymentMethod = payment?.selectedPaymentMethod || "";
  const payer = formData.payer || {};
  const paymentMethodId =
    formData.payment_method_id ||
    (selectedPaymentMethod === "bank_transfer" ? "pix" : selectedPaymentMethod) ||
    "pix";

  const request = {
    transaction_amount: order.totalAmount,
    description: buildPaymentDescription(order.lines),
    external_reference: orderId,
    statement_descriptor: "AASIAM",
    payment_method_id: paymentMethodId,
    metadata: {
      order_id: orderId,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_course: customer.course,
      customer_delivery: customer.delivery,
      items: order.lines.map((line) => ({
        product_id: line.productId,
        name: line.productName,
        variant: line.variant,
        quantity: line.quantity,
        unit_price: line.unitPriceCents / 100
      }))
    },
    payer: {
      email: payer.email || customer.email,
      first_name: customer.name.split(" ")[0] || customer.name
    },
    additional_info: {
      items: order.lines.map((line) => ({
        id: line.productId,
        title: line.variant ? `${line.productName} - ${line.variant}` : line.productName,
        quantity: line.quantity,
        unit_price: line.unitPriceCents / 100
      }))
    }
  };

  copyOptional(request, "token", formData.token);
  copyOptional(request, "installments", formData.installments);
  copyOptional(request, "issuer_id", formData.issuer_id);

  if (payer.identification?.number) {
    request.payer.identification = {
      type: payer.identification.type || "CPF",
      number: payer.identification.number
    };
  }

  return request;
}

async function createMercadoPagoPayment(paymentRequest, orderId) {
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mercadoPagoAccessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": orderId
    },
    body: JSON.stringify(paymentRequest)
  });

  const body = await response.json();

  if (!response.ok) {
    const message =
      body?.message ||
      body?.error ||
      "O Mercado Pago recusou a criacao do pagamento.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return body;
}

async function getMercadoPagoPayment(paymentId) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${mercadoPagoAccessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Pagamento ${paymentId} nao encontrado no Mercado Pago.`);
  }

  return response.json();
}

function createSimulatedPayment(paymentRequest, orderId) {
  return {
    id: `SIM-${orderId}`,
    status: "simulated",
    status_detail: "missing_mercado_pago_credentials",
    payment_method_id: paymentRequest.payment_method_id,
    payment_type_id: paymentRequest.payment_method_id === "pix" ? "bank_transfer" : "credit_card",
    transaction_amount: paymentRequest.transaction_amount,
    external_reference: orderId,
    payer: paymentRequest.payer,
    point_of_interaction: {
      transaction_data: {
        qr_code: "PIX-SIMULADO-CONFIGURE-MP_ACCESS_TOKEN-PARA-GERAR-COBRANCA-REAL"
      }
    }
  };
}

async function appendOrderToSheet({ orderId, customer, order, payment }) {
  if (!isGoogleSheetsConfigured()) {
    return { enabled: false, status: "not_configured" };
  }

  const auth = createGoogleAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const sheetName = process.env.GOOGLE_SHEETS_SHEET_NAME || "Pedidos";

  // Ensure header row exists on first use
  await ensureSheetHeader(sheets, spreadsheetId, sheetName);

  const paymentMethod = resolvePaymentMethod(payment);
  const installments = payment.installments > 1 ? `${payment.installments}x` : "À vista";
  const status = resolvePaymentStatus(payment.status);

  const row = [
    formatDateTime(),
    orderId,
    customer.name,
    customer.phone,
    order.lines.map(formatLineForSheet).join("\n"),
    order.totalAmount,
    paymentMethod,
    paymentMethod === "Pix" ? "—" : installments,
    status,
    payment.id || ""
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:J`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] }
  });

  return { enabled: true, status: "appended", sheetName };
}

async function ensureSheetHeader(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`
  });

  if (res.data.values?.length) return;

  const headers = [
    "Data/Hora", "ID Pedido", "Nome", "Telefone",
    "Itens", "Valor Total (R$)", "Pagamento", "Parcelas", "Status", "ID Pagamento"
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers] }
  });
}

function resolvePaymentMethod(payment) {
  const type = payment.payment_type_id || "";
  const method = payment.payment_method_id || "";
  if (type === "bank_transfer" || method === "pix") return "Pix";
  if (type === "credit_card") return "Cartão de Crédito";
  if (type === "debit_card") return "Cartão de Débito";
  if (method === "simulated" || payment.status === "simulated") return "Teste (simulado)";
  return method || type || "—";
}

function resolvePaymentStatus(status) {
  const map = {
    approved: "Aprovado",
    pending: "Pendente",
    in_process: "Em análise",
    rejected: "Recusado",
    cancelled: "Cancelado",
    refunded: "Reembolsado",
    simulated: "Teste (simulado)"
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

function buildPaymentDescription(lines) {
  const description = `Pedido AASIAM: ${lines
    .map((line) =>
      line.variant
        ? `${line.productName} ${line.variant} x${line.quantity}`
        : `${line.productName} x${line.quantity}`
    )
    .join(", ")}`;

  return description.slice(0, 255);
}

function formatLineForSheet(line) {
  const variant = line.variant ? ` (${line.variant})` : "";
  return `${line.productName}${variant} x${line.quantity}`;
}

function cleanText(value, maxLength) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function copyOptional(target, key, value) {
  if (value !== undefined && value !== null && value !== "") {
    target[key] = value;
  }
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
