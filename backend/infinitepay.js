const BASE_URL = "https://api.checkout.infinitepay.io";

/**
 * Cria um link de pagamento no Checkout Integrado da InfinitePay.
 *
 * @param {object} params
 * @param {string} params.orderId       - Identificador único do pedido (order_nsu)
 * @param {Array}  params.items         - [{ quantity, price (centavos), description }]
 * @param {object} params.cliente       - { nome, telefone, email opcional }
 * @returns {Promise<{ url: string }>}
 */
export async function criarLinkPagamento({ orderId, items, cliente }) {
  const handle = process.env.INFINITEPAY_HANDLE;

  if (!handle) {
    throw new Error("INFINITEPAY_HANDLE não configurado no .env");
  }

  const appUrl = process.env.APP_URL || "http://localhost:5173";
  const apiUrl = process.env.API_URL || "http://localhost:3333";

  const body = {
    handle,
    order_nsu: orderId,
    redirect_url: `${appUrl}?pedido=${orderId}&status=concluido`,
    webhook_url: `${apiUrl}/api/webhooks/infinitepay`,
    items: items.map((item) => ({
      quantity: item.quantity,
      price: item.price, // já em centavos
      description: item.description
    })),
    customer: {
      name: cliente.nome,
      phone_number: cliente.telefone
    }
  };

  if (cliente.email) {
    body.customer.email = cliente.email;
  }

  const res = await fetch(`${BASE_URL}/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.message || data?.error || "InfinitePay recusou a criação do link.";
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  if (!data.url) {
    throw new Error("InfinitePay não retornou a URL de pagamento.");
  }

  return { url: data.url };
}

/**
 * Verifica o status de um pagamento na InfinitePay.
 *
 * @param {object} params
 * @param {string} params.orderId        - order_nsu do pedido
 * @param {string} params.transactionNsu - transaction_nsu retornado pelo webhook
 * @param {string} params.slug           - invoice_slug retornado pelo webhook
 * @returns {Promise<{ success, paid, amount, paid_amount, installments, capture_method }>}
 */
export async function verificarPagamento({ orderId, transactionNsu, slug }) {
  const handle = process.env.INFINITEPAY_HANDLE;

  if (!handle) {
    throw new Error("INFINITEPAY_HANDLE não configurado no .env");
  }

  const res = await fetch(`${BASE_URL}/payment_check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle,
      order_nsu: orderId,
      transaction_nsu: transactionNsu,
      slug
    })
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.message || data?.error || "Erro ao verificar pagamento.";
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  return data;
}
