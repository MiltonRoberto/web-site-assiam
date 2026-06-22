import re

MAX_INPUT_LENGTH = 500

OFF_TOPIC_REPLY = (
    "Só consigo responder sobre a AASIAM, seus produtos e a atlética. "
    "Tem alguma dúvida sobre isso? 🐺"
)

INJECTION_REPLY = (
    "Não consigo seguir esse tipo de instrução. "
    "Estou aqui para responder sobre a AASIAM e seus produtos! 🐺"
)

# ── Padrões de prompt injection (PT + EN) ─────────────────────────────────────
_INJECTION_PATTERNS = [
    # Ignorar / esquecer instruções
    r"ignore\s+(as\s+)?(instru[cç][oõ]es?|regras?|tudo|anterior)",
    r"esque[cç]a?\s+(tudo|as\s+regras?|suas?\s+instru[cç][oõ]es?|seu\s+papel)",
    r"ignore\s+(previous|all|above|prior|your)\s+instructions?",
    r"forget\s+(all|everything|your\s+(rules?|instructions?))",

    # Roleplay / personagem / persona
    r"(fale|responda|aja|escreva)\s+(como\s+se\s+(fosse|voc[eê]\s+fosse)|como\s+(o|a|um|uma)\s+\w+)",
    r"finja\s+(ser|que\s+(é|voc[eê]\s+[eé]))",
    r"(seja|vire|torne-se)\s+(o|a|um|uma)\s+\w+",
    r"(act|speak|talk|write|respond)\s+as\s+(if\s+you\s+are|a\s+|the\s+)",
    r"pretend\s+(you\s+are|to\s+be)",
    r"roleplay",
    r"personagem",
    r"you\s+are\s+now\s+",

    # Nova persona / papel / identidade
    r"(nova?|novo)\s+(persona|papel|identidade|personagem|modo|rol)",
    r"new\s+(persona|role|identity|character|mode)",
    r"a\s+partir\s+de\s+agora\s+(voc[eê]\s+[eé]|seu\s+nome)",
    r"from\s+now\s+on\s+you\s+are",

    # Sobrescrever / sem restrições
    r"(override|bypass|disable|remove)\s+(instructions?|rules?|guidelines?|constraints?|filters?)",
    r"sem\s+(restri[cç][oõo]es?|limita[cç][oõo]es?|filtros?|regras?)",
    r"without\s+restrictions?",

    # Caracteres especiais / system tags
    r"<\s*/?\s*(system|instruction|prompt|assistant|user)\s*>",
    r"\[?\s*(system|assistant|user|inst)\s*\]?\s*:",

    # Termos clássicos de jailbreak
    r"\bjailbreak\b",
    r"\bDAN\b",
    r"do\s+anything\s+now",
    r"modo\s+(deus|god|dev|desenvolvedor|irrestrito|livre)",
    r"god\s+mode",
]

# ── Palavras de personagens / assuntos off-topic óbvios ──────────────────────
_ROLEPLAY_NAMES = [
    "goku", "naruto", "batman", "superman", "chatgpt", "openai", "gemini",
    "claude", "assistente\s+geral", "bot\s+geral", "ia\s+geral",
    "professor", "médico", "advogado", "psicólogo", "hacker",
]

_ROLEPLAY_TRIGGERS = re.compile(
    r"(fale|aja|seja|responda|escreva|finja|imite)\s+(como|sendo|igual|que)\s+.*(" +
    "|".join(_ROLEPLAY_NAMES) + r")",
    re.IGNORECASE,
)

_COMPILED_INJECTIONS = [re.compile(p, re.IGNORECASE) for p in _INJECTION_PATTERNS]

# ── Palavras-chave de tópico AASIAM ──────────────────────────────────────────
_TOPIC_KEYWORDS = [
    "aasiam", "atlética", "atletica", "alcateia", "lobo", "lobinho",
    "sisinfo", "sistemas", "sistemas de informação", "amf", "faculdade",
    "moletom", "blusa", "casaco", "camiseta", "camisa", "uniforme",
    "caneca", "tirante", "kit", "combo", "pacote",
    "mochila", "bolsa", "cachecol", "lenço",
    "produto", "produtos", "preço", "preco", "valor", "custo",
    "tamanho", "tam", "comprar", "compra", "loja", "pedido",
    "pagamento", "pix", "cartão", "cartao", "débito", "debito", "crédito", "credito",
    "frete", "entrega", "disponível", "disponivel", "esgotado",
    "evento", "esporte", "futebol", "vôlei", "volei", "truco", "campeonato",
    "jogo", "competição", "competicao", "time",
    "diretoria", "instagram", "whatsapp", "contato",
    "coleção", "colecao", "alcateia", "verde", "off-white", "bege",
]

# ── Assuntos explicitamente off-topic ────────────────────────────────────────
_OFF_TOPIC_PATTERNS = [
    r"\b(receita|receitas)\b",
    r"\b(clima|previsão\s+do\s+tempo|temperatura)\b",
    r"\b(política|política|eleição|presidente|governo)\b",
    r"\b(programação|código|python|javascript|java|html|css)\b",
    r"\b(piada|piadas|humor|engraçado)\b",
    r"\b(tradução|traduza|translate)\b",
    r"\b(resumo|resumir|resume)\b(?!\s+do\s+pedido)",
    r"\b(notícia|notícias|jornal|news)\b",
    r"\b(matemática|calcul[ae]|soma|equação)\b",
]
_COMPILED_OFF_TOPIC = [re.compile(p, re.IGNORECASE) for p in _OFF_TOPIC_PATTERNS]


def validate_input(pergunta: str) -> tuple[bool, str]:
    """Validação de entrada. Retorna (valido, mensagem_de_erro)."""
    pergunta = pergunta.strip()

    if not pergunta:
        return False, "Por favor, envie uma pergunta."

    if len(pergunta) > MAX_INPUT_LENGTH:
        return False, (
            f"Pergunta muito longa (máximo {MAX_INPUT_LENGTH} caracteres). "
            "Por favor, seja mais breve!"
        )

    # Injeção de prompt
    for pattern in _COMPILED_INJECTIONS:
        if pattern.search(pergunta):
            return False, INJECTION_REPLY

    # Roleplay com nome de personagem conhecido
    if _ROLEPLAY_TRIGGERS.search(pergunta):
        return False, INJECTION_REPLY

    return True, ""


def is_on_topic(pergunta: str) -> bool:
    """
    Retorna True se a pergunta é sobre a AASIAM.
    Bloqueia se contiver assuntos explicitamente off-topic,
    libera se contiver palavras-chave de tópico,
    libera perguntas curtas e genéricas (saudações, dúvidas gerais).
    """
    lower = pergunta.lower().strip()

    # Saudações e perguntas genéricas curtas passam (ex: "oi", "olá", "o que vocês vendem?")
    if len(lower) <= 40 and not any(p.search(lower) for p in _COMPILED_OFF_TOPIC):
        return True

    # Assunto explicitamente off-topic → bloqueia
    for pattern in _COMPILED_OFF_TOPIC:
        if pattern.search(lower):
            return False

    # Contém palavra-chave de tópico → libera
    if any(kw in lower for kw in _TOPIC_KEYWORDS):
        return True

    # Pergunta longa sem nenhuma palavra-chave → off-topic
    return False
