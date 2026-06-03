# AASIAM Pedidos

Aplicacao de pedidos para moletons, canecas, mochilas e mantas da atletica. O front-end funciona como um formulario de ecommerce, o servidor cria pagamentos no Mercado Pago e registra os pedidos no Google Sheets.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`.

## Configurar pagamentos

1. Copie `.env.example` para `.env`.
2. Preencha `VITE_MP_PUBLIC_KEY` e `MP_ACCESS_TOKEN` com credenciais do Mercado Pago.
3. Teste primeiro com credenciais `TEST`.
4. Para Pix e cartao, o front-end usa o Payment Brick e envia os dados para `POST /api/payments`.

## Configurar Google Sheets

1. Crie uma service account no Google Cloud.
2. Ative a Google Sheets API.
3. Compartilhe a planilha com o e-mail da service account.
4. Preencha no `.env`:

```bash
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SHEETS_SHEET_NAME=Pedidos
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Crie uma aba chamada `Pedidos` com estes cabecalhos:

```text
Data, Evento, Pedido, Nome, Telefone, Email, Curso, Entrega, Total, Quantidade, Itens, Pagamento, Status, Detalhe, Metodo, Tipo, Observacoes
```

## Precos e produtos

Edite `shared/products.js` para ajustar nomes, descricoes e valores. Os totais sao recalculados no servidor, entao o navegador nao consegue alterar o preco final enviado ao Mercado Pago.

## Webhook

Configure no Mercado Pago um webhook apontando para:

```text
https://seu-dominio.com/api/webhooks/mercado-pago
```

O webhook adiciona linhas de atualizacao de status na planilha quando o Mercado Pago notifica uma mudanca.
