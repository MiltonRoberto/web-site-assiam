export const HOODIE_SIZES = ["PP", "P", "M", "G", "GG", "XG"];

export const HOODIE_VARIANTS = [
  {
    code: "verde",
    name: "Verde",
    description: "Preto com verde neon da atletica.",
    swatch: "#12c86b"
  },
  {
    code: "bege",
    name: "Bege",
    description: "Base bege com contraste preto e verde.",
    swatch: "#c9b789"
  }
];

export const BACKPACK_MODELS = [
  {
    code: "campus",
    name: "Campus",
    description: "Modelo leve para rotina de aula."
  },
  {
    code: "tech",
    name: "Tech",
    description: "Modelo reforcado com mais compartimentos."
  }
];

export const PRODUCTS = [
  {
    id: "moletom-verde",
    kind: "sizedVariants",
    name: "Moletom Verde AASIAM",
    shortName: "Moletom Verde",
    description: "Moletom preto com detalhes verde neon da atlética.",
    priceCents: 14990,
    tag: "Escolha o tamanho",
    accent: "#12c86b",
    variants: [HOODIE_VARIANTS[0]],
    sizes: HOODIE_SIZES,
    images: ["/verde-frente.jpg", "/verde-costas.jpg"]
  },
  {
    id: "moletom-bege",
    kind: "sizedVariants",
    name: "Moletom Bege AASIAM",
    shortName: "Moletom Bege",
    description: "Base bege com contraste preto e verde da atlética.",
    priceCents: 14990,
    tag: "Escolha o tamanho",
    accent: "#c9b789",
    variants: [HOODIE_VARIANTS[1]],
    sizes: HOODIE_SIZES,
    images: ["/bege-frente.jpg", "/bege-costas.jpg"]
  },
  {
    id: "kit-2-moletons",
    kind: "doubleHoodie",
    name: "Kit 2 Moletons AASIAM",
    shortName: "Kit 2 Moletons",
    description: "Um moletom Verde + um Bege, cada um no seu tamanho.",
    priceCents: 26990,
    tag: "Verde + Bege",
    accent: "#7fff8a",
    includes: ["Moletom Verde", "Moletom Bege"],
    variants: HOODIE_VARIANTS,
    sizes: HOODIE_SIZES,
    defaultVerdeSize: "M",
    defaultBegeSize: "M",
    images: ["/verde-frente.jpg", "/bege-frente.jpg"]
  },
  {
    id: "kit-moletom-caneca",
    kind: "configuredBundle",
    name: "Kit Moletom + Caneca",
    shortName: "Kit M + Caneca",
    description: "Combo com moletom no tamanho escolhido e uma caneca.",
    priceCents: 17490,
    tag: "Combo",
    accent: "#9ff34f",
    includes: ["Moletom", "Caneca"],
    hasHoodie: true,
    variants: HOODIE_VARIANTS,
    sizes: HOODIE_SIZES,
    defaultHoodieVariant: "verde",
    defaultHoodieSize: "M"
  },
  {
    id: "caneca",
    kind: "quantity",
    name: "Caneca AASIAM",
    shortName: "Caneca",
    description: "Caneca personalizada com identidade da atletica.",
    priceCents: 3490,
    tag: "Unitario",
    accent: "#e8f7ef",
    images: ["/caneca.jpg"]
  },
  {
    id: "mochila",
    kind: "modelQuantity",
    name: "Mochila AASIAM",
    shortName: "Mochila",
    description: "Dois modelos para combinar com sua rotina.",
    priceCents: 8990,
    tag: "2 modelos",
    accent: "#0b1110",
    models: BACKPACK_MODELS
  },
  {
    id: "manta",
    kind: "quantity",
    name: "Manta AASIAM",
    shortName: "Manta",
    description: "Manta da atletica em preto, verde e branco.",
    priceCents: 6990,
    tag: "Conforto",
    accent: "#213a2c"
  },
  {
    id: "kit-completo",
    kind: "configuredBundle",
    name: "Kit Completo AASIAM",
    shortName: "Kit Completo",
    description: "Todos os itens: moletom, caneca, mochila e manta.",
    priceCents: 32990,
    tag: "Todos os itens",
    accent: "#18f08a",
    includes: ["Moletom", "Caneca", "Mochila", "Manta"],
    hasHoodie: true,
    hasBackpack: true,
    variants: HOODIE_VARIANTS,
    sizes: HOODIE_SIZES,
    models: BACKPACK_MODELS,
    defaultHoodieVariant: "verde",
    defaultHoodieSize: "M",
    defaultBackpackModel: "campus"
  }
];

export const PRODUCT_BY_ID = Object.fromEntries(
  PRODUCTS.map((product) => [product.id, product])
);
