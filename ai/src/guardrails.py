import re

MAX_INPUT_LENGTH = 500

# Padrões de prompt injection — case-insensitive
_INJECTION_PATTERNS = [
    r"ignore\s+(previous|all|above|prior|your)\s+instructions?",
    r"(system|assistant|user)\s*:",
    r"<\s*/?\s*(system|instruction|prompt)\s*>",
    r"you\s+are\s+now\s+",
    r"act\s+as\s+(if\s+you\s+are|a\s+)",
    r"pretend\s+(you\s+are|to\s+be)",
    r"forget\s+(all|everything|your\s+rules?|your\s+instructions?)",
    r"new\s+(persona|role|identity)",
    r"override\s+(instructions?|rules?|guidelines?|constraints?)",
    r"jailbreak",
    r"\bDAN\b",
    r"do\s+anything\s+now",
    r"without\s+restrictions?",
    r"ignore\s+all\s+rules",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in _INJECTION_PATTERNS]

OFF_TOPIC_REPLY = (
    "Só consigo responder sobre a AASIAM, seus produtos e a atlética. "
    "Tem alguma dúvida sobre isso? 🐺"
)

_TOPIC_KEYWORDS = [
    "aasiam", "atlética", "alcateia", "lobo", "sisinfo", "sistemas",
    "moletom", "camiseta", "caneca", "mochila", "cachecol", "combo",
    "kit", "produto", "preço", "valor", "tamanho", "comprar", "loja",
    "pedido", "pagamento", "pix", "frete", "entrega",
    "evento", "esporte", "futebol", "vôlei", "truco", "campeonato",
    "diretoria", "instagram", "whatsapp", "contato",
]


def validate_input(pergunta: str) -> tuple[bool, str]:
    """Valida entrada. Retorna (valido, mensagem_de_erro)."""
    pergunta = pergunta.strip()

    if not pergunta:
        return False, "Por favor, envie uma pergunta."

    if len(pergunta) > MAX_INPUT_LENGTH:
        return False, (
            f"Pergunta muito longa (máximo {MAX_INPUT_LENGTH} caracteres). "
            "Por favor, seja mais breve!"
        )

    for pattern in _COMPILED:
        if pattern.search(pergunta):
            return False, OFF_TOPIC_REPLY

    return True, ""


def is_on_topic(pergunta: str) -> bool:
    """Retorna True se a pergunta parece relacionada à AASIAM."""
    lower = pergunta.lower()
    return any(kw in lower for kw in _TOPIC_KEYWORDS)
