# AASIAM — Loja da Atlética

Loja de merchandise da **AASIAM** (Associação Atlética de Sistemas da AMF / Alcateia).  
Vende moletons, canecas, mochilas, cachecol e combos da Coleção Alcateia.

---

## Descrição do sistema

A loja é composta por três serviços independentes que se comunicam via HTTP:

- **Frontend**: interface da loja com carrinho, checkout e um chat de IA embutido
- **Backend**: API que processa pedidos, gera links de pagamento (InfinitePay) e registra compras no Google Sheets
- **IA (RAG)**: agente de perguntas e respostas que responde sobre produtos e a atlética com base em documentos de contexto — funciona via recuperação vetorial (ChromaDB) + LLM (Groq)

O chat de IA aparece como um widget 🐺 no canto inferior direito do site. O usuário digita uma pergunta, o agente busca trechos relevantes nos documentos indexados e o LLM formula a resposta. Nenhuma informação é inventada — se não estiver no contexto, o agente informa que não tem a informação.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                     Usuário                         │
└────────────────────────┬────────────────────────────┘
                         │ HTTPS
          ┌──────────────▼──────────────┐
          │      Frontend (Vercel)       │
          │   React 18 + Vite           │
          │   - Catálogo de produtos    │
          │   - Carrinho e checkout     │
          │   - Chat widget (IA)        │
          └───────┬──────────┬──────────┘
                  │          │ REST
            REST  │          └──────────────────────┐
                  │                                  │
     ┌────────────▼──────────────┐    ┌─────────────▼────────────┐
     │    Backend (Render)        │    │      IA / RAG (Render)    │
     │    Node.js + Express       │    │    Python + FastAPI       │
     │    - POST /checkout        │    │    - POST /perguntar      │
     │    - GET /status/:id       │    │    - POST /ingestao       │
     │    - Google Sheets API     │    │    - GET /health          │
     └────────────┬───────────────┘    └─────────────┬────────────┘
                  │                                   │
     ┌────────────▼───────────────┐    ┌─────────────▼────────────┐
     │      InfinitePay            │    │   ChromaDB + FastEmbed   │
     │  (Pix / Cartão / Débito)   │    │   (banco vetorial local) │
     └────────────────────────────┘    └──────────────────────────┘
```

### Fluxo do agente RAG

```
Pergunta do usuário
       │
       ▼
FastEmbedEmbeddings          ← gera embedding da pergunta (local, ONNX)
       │
       ▼
ChromaDB (MMR retrieval)     ← busca os 5 chunks mais relevantes
       │
       ▼
Groq LLM (llama-3.3-70b)    ← formula a resposta com base no contexto
       │
       ▼
Resposta ao usuário
```

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | React 18, Vite 6, GSAP, Radix UI Colors, Lucide React |
| Backend | Node.js 20, Express 5, Google Sheets API |
| Pagamentos | InfinitePay (Pix, cartão, débito) |
| IA / RAG | Python 3.11, FastAPI, LangChain, ChromaDB |
| Embeddings | FastEmbed + ONNX Runtime (`BAAI/bge-small-en-v1.5`) — sem custo, sem API key |
| LLM | Groq API — `llama-3.3-70b-versatile` (gratuito) |
| Hospedagem | Vercel (frontend), Render (backend + IA) |
| Containerização | Docker (serviço de IA) |

---

## Estrutura do projeto

```
lojaAASIAM/
├── frontend/            # React 18 + Vite — interface da loja e chat de IA
│   ├── src/
│   │   ├── App.jsx      # Componente principal, rotas e produtos
│   │   ├── ChatWidget.jsx  # Widget de chat da IA
│   │   └── ...
│   ├── .env.example
│   └── vercel.json
├── backend/             # Node.js + Express — pagamentos e pedidos
│   ├── src/
│   └── .env.example
├── ai/                  # Python + FastAPI — agente RAG
│   ├── docs/            # PDFs e TXTs de contexto da IA (adicione aqui)
│   ├── src/
│   │   ├── main.py      # Rotas FastAPI
│   │   ├── agente.py    # Chain RAG (retriever + LLM)
│   │   ├── ingestao.py  # Indexação de documentos
│   │   └── config.py    # Configuração via .env
│   ├── Dockerfile
│   ├── render.yaml
│   └── requirements.txt
└── docker-compose.yml
```

---

## Reproduzindo o ambiente localmente

### Pré-requisitos

- **Node.js** 20+
- **Python** 3.11+
- **Git Bash** ou **PowerShell** (Windows)

---

### 1. Clonar o repositório

```bash
git clone https://github.com/ZanonDeAndrade/lojaAASIAM.git
cd lojaAASIAM
```

---

### 2. Serviço de IA

#### 2.1 Obter a chave Groq (gratuito)

Acesse [console.groq.com/keys](https://console.groq.com/keys), crie uma conta e gere uma API Key.

#### 2.2 Configurar o .env

```bash
cd ai
cp .env.example .env      # Git Bash
# ou
copy .env.example .env    # PowerShell / CMD
```

Abra `ai/.env` e preencha:

```env
GROQ_API_KEY=gsk_suachaveaqui
```

#### 2.3 Criar o ambiente virtual e instalar dependências

```bash
# PowerShell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Git Bash
python -m venv .venv
source .venv/Scripts/activate
pip install -r requirements.txt
```

> Na primeira instalação o FastEmbed baixa o modelo de embeddings (~130 MB via onnxruntime).

#### 2.4 Adicionar documentos de contexto

Coloque arquivos `.pdf` ou `.txt` em `ai/docs/`.  
Exemplos: catálogo de produtos, sobre a atlética, FAQ, regulamentos.

#### 2.5 Subir o serviço

```bash
# Git Bash (dentro de ai/ com venv ativo)
.venv/Scripts/python.exe -m uvicorn src.main:app --port 8000
```

Confirme: `http://localhost:8000/health` → `{"status":"ok"}`

#### 2.6 Indexar os documentos

```bash
curl -X POST http://localhost:8000/ingestao
# → {"chunks_indexados": N}
```

Repita sempre que adicionar ou editar arquivos em `ai/docs/`.

---

### 3. Backend

```bash
cd backend
cp .env.example .env   # ou copy no Windows
```

Preencha `backend/.env`:

```env
PORT=3333
APP_URL=http://localhost:5173/
API_URL=http://localhost:3333/

# InfinitePay — handle da conta (parte final do link de pagamento)
INFINITEPAY_HANDLE=seu_handle

# Google Sheets — registro de pedidos
GOOGLE_SHEETS_SPREADSHEET_ID=id_da_planilha
GOOGLE_SHEETS_SHEET_NAME=Pedidos AASIAM
GOOGLE_SERVICE_ACCOUNT_EMAIL=conta@projeto.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Dev: simula pagamento sem redirecionar
MOCK_PAYMENT_ENABLED=true
```

```bash
npm install
npm run dev
```

#### Configurar Google Sheets

1. Crie uma service account no [Google Cloud Console](https://console.cloud.google.com)
2. Ative a **Google Sheets API**
3. Compartilhe a planilha com o e-mail da service account
4. O ID da planilha está na URL: `https://docs.google.com/spreadsheets/d/**ID**/edit`

Valide: `http://localhost:3333/api/health` → `googleSheetsConfigured: true`

---

### 4. Frontend

```bash
cd frontend
cp .env.example .env   # ou copy no Windows
npm install
npm run dev
```

Acesse: `http://localhost:5173`

**Variáveis de ambiente do frontend:**

| Variável | Padrão (dev) | Descrição |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3333` | URL do backend |
| `VITE_AI_URL` | `http://localhost:8000` | URL do serviço de IA |

---

### 5. Rodar tudo junto

Abra **3 terminais**:

| Terminal | Diretório | Comando | Porta |
|---|---|---|---|
| IA | `ai/` | `.venv/Scripts/python.exe -m uvicorn src.main:app --port 8000` | 8000 |
| Backend | `backend/` | `npm run dev` | 3333 |
| Frontend | `frontend/` | `npm run dev` | 5173 |

---

## Deploy em produção

### Frontend → Vercel

1. Importe o repositório no [vercel.com](https://vercel.com)
2. Root directory: `frontend`
3. Adicione as variáveis de ambiente no painel do Vercel:
   ```
   VITE_API_URL = https://seu-backend.onrender.com
   VITE_AI_URL  = https://loja-aasiam-ai.onrender.com
   ```
4. Deploy automático a cada push no `main`

### Backend + IA → Render

O arquivo `ai/render.yaml` já está configurado. No painel do Render:

1. New → Web Service → conecta o repositório GitHub
2. Root directory: `ai` | Runtime: **Docker**
3. Adiciona a variável de ambiente:
   ```
   GROQ_API_KEY = gsk_suachave
   ```
4. Deploy

O build do Docker (~5-10 min) baixa o modelo de embeddings, indexa os documentos de `ai/docs/` e bake o ChromaDB na imagem. Ao subir o container, a IA já está pronta para responder.

> Para atualizar os documentos da IA em produção: edite os arquivos em `ai/docs/`, faça push — o Render reconstrói a imagem automaticamente.

---

## Endpoints do serviço de IA

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Verifica se o serviço está no ar |
| `POST` | `/ingestao` | Reindexar documentos de `docs/` no ChromaDB |
| `POST` | `/perguntar` | Enviar uma pergunta ao agente |

**Exemplo de uso:**

```bash
curl -X POST http://localhost:8000/perguntar \
  -H "Content-Type: application/json" \
  -d '{"pergunta": "Quais tamanhos tem o moletom?"}'
```
