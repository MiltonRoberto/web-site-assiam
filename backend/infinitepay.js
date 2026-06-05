import https from "node:https";
import { constants } from "node:crypto";

const BASE_URL = "https://api.checkout.infinitepay.io";

// Node 18+/OpenSSL 3 rejects legacy TLS cipher suites used by InfinitePay.
// SSL_OP_LEGACY_SERVER_CONNECT allows the handshake to complete normally.
const tlsAgent = new https.Agent({
  secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
});

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        agent: tlsAgent,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/**
 * Cria um link de pagamento no Checkout Integrado da InfinitePay.
 */
export async function criarLinkPagamento({ orderId, items, cliente }) {
  const handle = process.env.INFINITEPAY_HANDLE;

  if (!handle) {
    throw new Error("INFINITEPAY_HANDLE não configurado no .env");
  }

  const appUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const apiUrl = process.env.BACKEND_URL || "http://localhost:3333";

  const payload = {
    handle,
    order_nsu: orderId,
    redirect_url: `${appUrl}?pedido=${orderId}&status=concluido`,
    webhook_url: `${apiUrl}/api/webhooks/infinitepay`,
    items: items.map((item) => ({
      quantity: item.quantity,
      price: item.price,
      description: item.description,
    })),
    customer: {
      name: cliente.nome,
      phone_number: cliente.telefone,
    },
  };

  if (cliente.email) {
    payload.customer.email = cliente.email;
  }

  const { status, body } = await httpsPost(`${BASE_URL}/links`, payload);

  if (status < 200 || status >= 300) {
    const msg = body?.message || body?.error || "InfinitePay recusou a criação do link.";
    const err = new Error(msg);
    err.status = status;
    throw err;
  }

  if (!body.url) {
    throw new Error("InfinitePay não retornou a URL de pagamento.");
  }

  return { url: body.url };
}

/**
 * Verifica o status de um pagamento na InfinitePay.
 */
export async function verificarPagamento({ orderId, transactionNsu, slug }) {
  const handle = process.env.INFINITEPAY_HANDLE;

  if (!handle) {
    throw new Error("INFINITEPAY_HANDLE não configurado no .env");
  }

  const { status, body } = await httpsPost(`${BASE_URL}/payment_check`, {
    handle,
    order_nsu: orderId,
    transaction_nsu: transactionNsu,
    slug,
  });

  if (status < 200 || status >= 300) {
    const msg = body?.message || body?.error || "Erro ao verificar pagamento.";
    const err = new Error(msg);
    err.status = status;
    throw err;
  }

  return body;
}
