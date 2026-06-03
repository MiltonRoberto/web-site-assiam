import {
  ArrowLeft,
  Backpack,
  BedDouble,
  Check,
  CheckCircle2,
  ChevronRight,
  Coffee,
  Copy,
  CreditCard,
  PackageCheck,
  Phone,
  QrCode,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Shirt,
  User,
  X,
  Minus,
  Plus,
  Trash2
} from "lucide-react";
import { initMercadoPago, Payment } from "@mercadopago/sdk-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PRODUCTS } from "../../shared/products.js";
import { calculateOrder, createEmptySelection } from "../../shared/order.js";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const steps = [
  { id: "shop", label: "Produtos" },
  { id: "dados", label: "Dados" },
  { id: "conferencia", label: "Revisão" },
  { id: "pagamento", label: "Pagamento" }
];

const productIcons = {
  "moletom-verde": Shirt,
  "moletom-bege": Shirt,
  moletom: Shirt,
  "kit-2-moletons": Shirt,
  caneca: Coffee,
  mochila: Backpack,
  manta: BedDouble,
  "kit-moletom-caneca": PackageCheck,
  "kit-completo": ShoppingBag
};

const initialCustomer = { name: "", phone: "" };
const preferredLogoSource = "/logo-aasiam.jpg";
const fallbackLogoSource = "/logo-aasiam.svg";

export default function App() {
  const [customer, setCustomer] = useState(initialCustomer);
  const [selection, setSelection] = useState(() => createEmptySelection());
  const [step, setStep] = useState("dados");
  const [cartOpen, setCartOpen] = useState(false);
  const [customerSubmitted, setCustomerSubmitted] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const order = useMemo(() => calculateOrder(selection), [selection]);
  const customerValidation = useMemo(() => validateCustomer(customer), [customer]);
  const orderValidation = useMemo(() => validateOrder(order), [order]);

  function updateQuantity(productId, quantity) {
    setSelection((c) => ({ ...c, [productId]: { ...c[productId], quantity: norm(quantity) } }));
  }

  function updateSizedVariant(productId, variantCode, size, quantity) {
    setSelection((c) => ({
      ...c,
      [productId]: {
        ...c[productId],
        variants: {
          ...c[productId].variants,
          [variantCode]: { ...c[productId].variants[variantCode], [size]: norm(quantity) }
        }
      }
    }));
  }

  function updateModelQuantity(productId, modelCode, quantity) {
    setSelection((c) => ({
      ...c,
      [productId]: { ...c[productId], models: { ...c[productId].models, [modelCode]: norm(quantity) } }
    }));
  }

  function updateBundleOption(productId, field, value) {
    setSelection((c) => ({ ...c, [productId]: { ...c[productId], [field]: value } }));
  }

  function submitCustomer(e) {
    e.preventDefault();
    setCustomerSubmitted(true);
    if (!customerValidation.valid) return;
    goToStep("shop");
  }

  function goToStep(next) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetOrder() {
    setCustomer(initialCustomer);
    setSelection(createEmptySelection());
    setCustomerSubmitted(false);
    setLastResult(null);
    goToStep("dados");
  }

  return (
    <div className="app-root">
      <SiteHeader
        step={step}
        order={order}
        cartOpen={cartOpen}
        onCartToggle={() => setCartOpen((o) => !o)}
        onStepClick={(s) => step !== "shop" && goToStep(s)}
      />

      {step === "shop" && (
        <ShopPage
          selection={selection}
          order={order}
          orderValidation={orderValidation}
          onQuantityChange={updateQuantity}
          onSizedVariantChange={updateSizedVariant}
          onModelQuantityChange={updateModelQuantity}
          onBundleOptionChange={updateBundleOption}
          onCheckout={() => goToStep("conferencia")}
          cartOpen={cartOpen}
          onCartClose={() => setCartOpen(false)}
        />
      )}

      {step === "dados" && (
        <CustomerStep
          customer={customer}
          validation={customerValidation}
          submitted={customerSubmitted}
          onChange={(f, v) => setCustomer((c) => ({ ...c, [f]: v }))}
          onSubmit={submitCustomer}
        />
      )}

      {step === "conferencia" && (
        <ReviewStep
          customer={customer}
          order={order}
          onBack={() => goToStep("dados")}
          onPayment={() => goToStep("pagamento")}
        />
      )}

      {step === "pagamento" && (
        <PaymentStep
          customer={customer}
          selection={selection}
          order={order}
          onBack={() => goToStep("conferencia")}
          onFinished={setLastResult}
          onNewOrder={resetOrder}
        />
      )}
    </div>
  );
}

/* ─── HEADER ─── */
function SiteHeader({ step, order, cartOpen, onCartToggle }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <div className="brand-lockup">
          <LogoMark />
          <div>
            <p className="eyebrow">Associação Atlética de SI</p>
            <h1>AASIAM</h1>
          </div>
        </div>

        <StepRail currentStep={step} />

        <button
          type="button"
          className={`cart-btn ${cartOpen ? "cart-btn-active" : ""}`}
          onClick={onCartToggle}
          aria-label="Abrir carrinho"
        >
          <ShoppingCart size={20} />
          {order.totalQuantity > 0 && (
            <span className="cart-badge">{order.totalQuantity}</span>
          )}
          {order.totalQuantity > 0 && (
            <span className="cart-total">{currency.format(order.totalAmount)}</span>
          )}
        </button>
      </div>
    </header>
  );
}

/* ─── LOGO ─── */
function LogoMark({ large = false }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`logo-mark ${large ? "logo-mark-large" : ""}`}>
      {broken ? <span>SI</span> : (
        <img src={preferredLogoSource} alt="Logo AASIAM" onError={() => setBroken(true)} />
      )}
    </div>
  );
}

/* ─── STEP RAIL ─── */
function StepRail({ currentStep }) {
  const idx = steps.findIndex((s) => s.id === currentStep);
  return (
    <nav className="step-rail" aria-label="Etapas">
      {steps.map((s, i) => (
        <span key={s.id} className={`step-pill ${i <= idx ? "step-pill-active" : ""}`}>
          <span className="step-pill-num">{i < idx ? <Check size={9} /> : i + 1}</span>
          {s.label}
        </span>
      ))}
    </nav>
  );
}

/* ─── SHOP PAGE ─── */
function ShopPage({
  selection, order, orderValidation,
  onQuantityChange, onSizedVariantChange, onModelQuantityChange, onBundleOptionChange,
  onCheckout, cartOpen, onCartClose
}) {
  const sectionRefs = useRef({});

  function scrollTo(productId) {
    sectionRefs.current[productId]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="shop-layout">
      <ProductNavBar products={PRODUCTS} onNav={scrollTo} order={order} />

      <main className="shop-main">
        <div className="product-list">
          {PRODUCTS.map((product) => (
            <div
              key={product.id}
              id={`product-${product.id}`}
              ref={(el) => { sectionRefs.current[product.id] = el; }}
            >
              <ProductCard
                product={product}
                selection={selection[product.id]}
                onQuantityChange={onQuantityChange}
                onSizedVariantChange={onSizedVariantChange}
                onModelQuantityChange={onModelQuantityChange}
                onBundleOptionChange={onBundleOptionChange}
              />
            </div>
          ))}
        </div>
      </main>

      {/* Cart drawer */}
      <CartDrawer
        open={cartOpen}
        order={order}
        validation={orderValidation}
        onClose={onCartClose}
        onCheckout={onCheckout}
      />

      {/* Overlay */}
      {cartOpen && <div className="cart-overlay" onClick={onCartClose} />}

      {/* Sticky checkout bar */}
      {order.totalQuantity > 0 && (
        <div className="checkout-bar">
          <span className="checkout-bar-info">
            <ShoppingCart size={18} />
            {order.totalQuantity} {order.totalQuantity === 1 ? "item" : "itens"} — {currency.format(order.totalAmount)}
          </span>
          <button type="button" className="primary-button checkout-bar-btn" onClick={onCheckout}>
            Finalizar Pedido <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── PRODUCT NAV BAR ─── */
function ProductNavBar({ products, onNav, order }) {
  return (
    <nav className="product-nav" aria-label="Navegar por produto">
      <div className="product-nav-inner">
        {products.map((p) => {
          const Icon = productIcons[p.id] || ShoppingBag;
          const qty = getProductQty(p, order);
          return (
            <button
              key={p.id}
              type="button"
              className={`product-nav-item ${qty > 0 ? "product-nav-item-active" : ""}`}
              onClick={() => onNav(p.id)}
            >
              <Icon size={14} />
              <span>{p.shortName}</span>
              {qty > 0 && <span className="product-nav-badge">{qty}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ─── CART DRAWER ─── */
function CartDrawer({ open, order, validation, onClose, onCheckout }) {
  return (
    <aside className={`cart-drawer ${open ? "cart-drawer-open" : ""}`} aria-label="Carrinho">
      <div className="cart-drawer-head">
        <h2><ShoppingCart size={20} /> Carrinho</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar carrinho">
          <X size={20} />
        </button>
      </div>

      <div className="cart-drawer-body">
        {order.lines.length === 0 ? (
          <div className="cart-empty">
            <ShoppingCart size={40} />
            <p>Seu carrinho está vazio</p>
            <small>Adicione produtos abaixo</small>
          </div>
        ) : (
          <div className="cart-lines">
            {order.lines.map((line) => (
              <div className="cart-line" key={`${line.productId}-${line.variantCode}`}>
                <div className="cart-line-info">
                  <strong>{line.productName}</strong>
                  {line.variant && <small>{line.variant}</small>}
                  <span>x{line.quantity}</span>
                </div>
                <strong className="cart-line-price">{currency.format(line.totalCents / 100)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      {order.lines.length > 0 && (
        <div className="cart-drawer-foot">
          <div className="cart-total-row">
            <span>Total</span>
            <strong>{currency.format(order.totalAmount)}</strong>
          </div>
          <div className="trust-badges">
            <span><ShieldCheck size={14} /> Pagamento seguro</span>
            <span><CheckCircle2 size={14} /> Pedido registrado</span>
          </div>
          {!validation.valid && (
            <div className="validation-box">{validation.messages.map((m) => <span key={m}>{m}</span>)}</div>
          )}
          <button type="button" className="primary-button" onClick={onCheckout} disabled={!validation.valid}>
            Finalizar Pedido <ChevronRight size={16} />
          </button>
        </div>
      )}
    </aside>
  );
}

/* ─── PRODUCT CARD ─── */
function ProductCard({ product, selection, onQuantityChange, onSizedVariantChange, onModelQuantityChange, onBundleOptionChange }) {
  const [added, setAdded] = useState(false);
  const Icon = productIcons[product.id] || PackageCheck;
  const qty = getProductSelectionQty(product, selection);

  function handleAdd() {
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <article className="product-card">
      <div className="product-card-inner">
        {/* Image */}
        <div className="product-card-media">
          {product.images?.length > 0
            ? <ImageCarousel images={product.images} alt={product.name} />
            : <div className="product-art-placeholder"><Icon size={64} /></div>
          }
          <div className="product-badge">{product.tag}</div>
        </div>

        {/* Info + options */}
        <div className="product-card-content">
          <div className="product-card-top">
            <div>
              <h3 className="product-name">{product.name}</h3>
              <p className="product-desc">{product.description}</p>
            </div>
            <div className="product-price">{currency.format(product.priceCents / 100)}</div>
          </div>

          <div className="product-card-options">
            {product.kind === "sizedVariants" && (
              <SizedVariantSelector
                product={product}
                selection={selection}
                onChange={onSizedVariantChange}
              />
            )}
            {product.kind === "doubleHoodie" && (
              <DoubleHoodieSelector
                product={product}
                selection={selection}
                onOptionChange={onBundleOptionChange}
                onQuantityChange={onQuantityChange}
              />
            )}
            {product.kind === "modelQuantity" && (
              <ModelSelector product={product} selection={selection} onChange={onModelQuantityChange} />
            )}
            {product.kind === "configuredBundle" && (
              <BundleSelector
                product={product}
                selection={selection}
                onQuantityChange={onQuantityChange}
                onOptionChange={onBundleOptionChange}
              />
            )}
            {product.kind === "quantity" && (
              <div className="quantity-row">
                <span className="quantity-label">Quantidade</span>
                <QuantityStepper
                  value={selection.quantity}
                  onChange={(v) => onQuantityChange(product.id, v)}
                  label={`Quantidade de ${product.shortName}`}
                  compact={false}
                />
              </div>
            )}
          </div>

          <div className="product-card-footer">
            <div className="product-card-subtotal">
              {qty > 0 && (
                <span className="product-qty-badge">
                  <Check size={12} /> {qty} no carrinho
                </span>
              )}
            </div>
            <button
              type="button"
              className={`add-btn ${added ? "add-btn-done" : ""} ${qty > 0 ? "add-btn-has" : ""}`}
              onClick={handleAdd}
            >
              {added ? <><Check size={16} /> Adicionado!</> : <><Plus size={16} /> Adicionar</>}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ─── IMAGE CAROUSEL ─── */
function ImageCarousel({ images, alt }) {
  const [index, setIndex] = useState(0);
  if (images.length === 1) return <img className="product-img" src={images[0]} alt={alt} />;
  return (
    <div className="carousel">
      <img className="product-img" src={images[index]} alt={`${alt} ${index + 1}`} />
      <button type="button" className="carousel-btn carousel-btn-left" onClick={() => setIndex((i) => (i === 0 ? images.length - 1 : i - 1))} aria-label="Anterior">‹</button>
      <button type="button" className="carousel-btn carousel-btn-right" onClick={() => setIndex((i) => (i === images.length - 1 ? 0 : i + 1))} aria-label="Próxima">›</button>
      <div className="carousel-dots">
        {images.map((_, i) => (
          <span key={i} className={`carousel-dot ${i === index ? "carousel-dot-active" : ""}`} onClick={() => setIndex(i)} />
        ))}
      </div>
    </div>
  );
}

/* ─── SIZED VARIANT SELECTOR ─── */
function SizedVariantSelector({ product, selection, onChange }) {
  const defaultSize = product.sizes[2] ?? product.sizes[0];
  const variant = product.variants[0];
  const [activeSize, setActiveSize] = useState(defaultSize);

  const currentQty = selection?.variants?.[variant.code]?.[activeSize] ?? 0;

  function handleSizeChange(size) {
    product.sizes.forEach((s) => onChange(product.id, variant.code, s, 0));
    setActiveSize(size);
  }

  function handleQtyChange(qty) {
    product.sizes.forEach((s) => onChange(product.id, variant.code, s, s === activeSize ? qty : 0));
  }

  return (
    <div className="options-block">
      <div className="bundle-section-label">Tamanho</div>
      <div className="size-chips">
        {product.sizes.map((size) => (
          <button key={size} type="button"
            className={`size-chip ${activeSize === size ? "size-chip-active" : ""}`}
            onClick={() => handleSizeChange(size)}
          >{size}</button>
        ))}
      </div>
      <div className="quantity-row">
        <span className="quantity-label">Quantidade</span>
        <QuantityStepper value={currentQty} onChange={handleQtyChange} label={`Quantidade ${variant.name} ${activeSize}`} compact={false} />
      </div>
    </div>
  );
}

/* ─── DOUBLE HOODIE SELECTOR ─── */
function DoubleHoodieSelector({ product, selection, onOptionChange, onQuantityChange }) {
  const verde = product.variants.find((v) => v.code === "verde");
  const bege = product.variants.find((v) => v.code === "bege");

  return (
    <div className="options-block">
      <div className="bundle-includes">
        {product.includes.map((item) => <span key={item}>{item}</span>)}
      </div>

      <div className="double-hoodie-grid">
        <div className="double-hoodie-col">
          <div className="double-hoodie-head">
            <span className="color-swatch" style={{ background: verde.swatch }} />
            <span>{verde.name}</span>
          </div>
          <div className="bundle-section-label">Tamanho</div>
          <div className="size-chips">
            {product.sizes.map((size) => (
              <button key={size} type="button"
                className={`size-chip ${selection?.verdeSize === size ? "size-chip-active" : ""}`}
                onClick={() => onOptionChange(product.id, "verdeSize", size)}
              >{size}</button>
            ))}
          </div>
        </div>

        <div className="double-hoodie-col">
          <div className="double-hoodie-head">
            <span className="color-swatch" style={{ background: bege.swatch }} />
            <span>{bege.name}</span>
          </div>
          <div className="bundle-section-label">Tamanho</div>
          <div className="size-chips">
            {product.sizes.map((size) => (
              <button key={size} type="button"
                className={`size-chip ${selection?.begeSize === size ? "size-chip-active" : ""}`}
                onClick={() => onOptionChange(product.id, "begeSize", size)}
              >{size}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="quantity-row">
        <span className="quantity-label">Quantidade</span>
        <QuantityStepper
          value={selection?.quantity ?? 0}
          onChange={(v) => onQuantityChange(product.id, v)}
          label="Quantidade do kit"
          compact={false}
        />
      </div>
    </div>
  );
}

/* ─── MODEL SELECTOR ─── */
function ModelSelector({ product, selection, onChange }) {
  return (
    <div className="options-block">
      <div className="bundle-section-label">Modelo</div>
      <div className="option-list">
        {product.models.map((model) => (
          <div className="model-row" key={model.code}>
            <div>
              <strong>{model.name}</strong>
              <small>{model.description}</small>
            </div>
            <QuantityStepper
              value={selection.models[model.code]}
              onChange={(v) => onChange(product.id, model.code, v)}
              label={`Quantidade mochila ${model.name}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── BUNDLE SELECTOR ─── */
function BundleSelector({ product, selection, onQuantityChange, onOptionChange }) {
  return (
    <div className="options-block">
      <div className="bundle-includes">
        {product.includes.map((item) => <span key={item}>{item}</span>)}
      </div>

      {product.hasHoodie && (
        <>
          <div className="bundle-section-label">Tipo do moletom</div>
          <div className="option-chips">
            {product.variants.map((v) => (
              <button key={v.code} type="button"
                className={`option-chip ${selection.hoodieVariant === v.code ? "option-chip-active" : ""}`}
                onClick={() => onOptionChange(product.id, "hoodieVariant", v.code)}
              >
                <span className="color-swatch" style={{ background: v.swatch }} />
                {v.name}
                {selection.hoodieVariant === v.code && <Check size={13} />}
              </button>
            ))}
          </div>
          <div className="bundle-section-label">Tamanho</div>
          <div className="size-chips">
            {product.sizes.map((size) => (
              <button key={size} type="button"
                className={`size-chip ${selection.hoodieSize === size ? "size-chip-active" : ""}`}
                onClick={() => onOptionChange(product.id, "hoodieSize", size)}
              >{size}</button>
            ))}
          </div>
        </>
      )}

      {product.hasBackpack && (
        <>
          <div className="bundle-section-label">Modelo de mochila</div>
          <div className="option-chips">
            {product.models.map((m) => (
              <button key={m.code} type="button"
                className={`option-chip ${selection.backpackModel === m.code ? "option-chip-active" : ""}`}
                onClick={() => onOptionChange(product.id, "backpackModel", m.code)}
              >
                {m.name}
                {selection.backpackModel === m.code && <Check size={13} />}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="quantity-row">
        <span className="quantity-label">Quantidade</span>
        <QuantityStepper
          value={selection.quantity}
          onChange={(v) => onQuantityChange(product.id, v)}
          label={`Quantidade de ${product.shortName}`}
          compact={false}
        />
      </div>
    </div>
  );
}

/* ─── QUANTITY STEPPER ─── */
function QuantityStepper({ value, onChange, label, compact = true }) {
  return (
    <div className={`stepper ${compact ? "stepper-compact" : ""}`} aria-label={label}>
      <button type="button" aria-label="Diminuir" onClick={() => onChange(Math.max(0, value - 1))}><Minus size={14} /></button>
      <input value={value} aria-label={label} inputMode="numeric" onChange={(e) => onChange(e.target.value)} />
      <button type="button" aria-label="Aumentar" onClick={() => onChange(value + 1)}><Plus size={14} /></button>
    </div>
  );
}

/* ─── CUSTOMER STEP ─── */
function CustomerStep({ customer, validation, submitted, onChange, onSubmit }) {
  return (
    <main className="step-page">
      <div className="step-page-inner">
        <div className="step-card">
          <div className="section-title">
            <User size={22} />
            <div>
              <h2>Seus dados</h2>
              <p>Nome e telefone para identificar a compra.</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="customer-form">
            <label>
              Nome completo
              <span className="field-control">
                <User size={16} />
                <input value={customer.name} onChange={(e) => onChange("name", e.target.value)} autoComplete="name" placeholder="Seu nome completo" />
              </span>
            </label>
            <label>
              Telefone
              <span className="field-control">
                <Phone size={16} />
                <input value={customer.phone} onChange={(e) => onChange("phone", e.target.value)} autoComplete="tel" inputMode="tel" placeholder="(44) 99999-9999" />
              </span>
            </label>

            {submitted && !validation.valid && (
              <div className="validation-box">
                {validation.messages.map((m) => <span key={m}>{m}</span>)}
              </div>
            )}

            <button type="submit" className="primary-button">
              Continuar <ChevronRight size={16} />
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

/* ─── REVIEW STEP ─── */
function ReviewStep({ customer, order, onBack, onPayment }) {
  return (
    <main className="step-page">
      <div className="step-page-inner">
        <button type="button" className="ghost-button back-btn" onClick={onBack}>
          <ArrowLeft size={16} /> Voltar
        </button>

        <div className="step-card">
          <div className="section-title">
            <CheckCircle2 size={22} />
            <div><h2>Revisar pedido</h2><p>Confirme os dados antes de pagar.</p></div>
          </div>

          <div className="review-grid">
            <div className="review-data"><span>Nome</span><strong>{customer.name}</strong></div>
            <div className="review-data"><span>Telefone</span><strong>{customer.phone}</strong></div>
          </div>

          <div className="review-lines">
            <OrderLines order={order} />
            <TotalRow order={order} />
          </div>

          <div className="review-actions">
            <button type="button" className="ghost-button" onClick={onBack}>Ajustar</button>
            <button type="button" className="primary-button review-pay-btn" onClick={onPayment}>
              Ir para pagamento <CreditCard size={16} />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ─── ORDER LINES ─── */
function OrderLines({ order }) {
  if (order.lines.length === 0) return <p className="empty-summary">Nenhum item.</p>;
  return (
    <div className="summary-lines">
      {order.lines.map((line) => (
        <div className="summary-line" key={`${line.productId}-${line.variantCode}`}>
          <span>
            {line.productName}
            {line.variant && <small>{line.variant}</small>}
            <small>x{line.quantity}</small>
          </span>
          <strong>{currency.format(line.totalCents / 100)}</strong>
        </div>
      ))}
    </div>
  );
}

function TotalRow({ order }) {
  return (
    <div className="total-row">
      <span>Total</span>
      <strong>{currency.format(order.totalAmount)}</strong>
    </div>
  );
}

/* ─── PAYMENT STEP ─── */
function PaymentStep({ customer, selection, order, onBack, onFinished, onNewOrder }) {
  const [config, setConfig] = useState(null);
  const [paymentResult, setPaymentResult] = useState(null);
  const [paymentError, setPaymentError] = useState("");
  const [brickReady, setBrickReady] = useState(false);
  const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig({ mercadoPagoConfigured: false, googleSheetsConfigured: false }));
  }, []);

  useEffect(() => {
    if (publicKey) initMercadoPago(publicKey, { locale: "pt-BR" });
  }, [publicKey]);

  const initialization = useMemo(() => ({ amount: order.totalAmount, payer: { email: "" } }), [order.totalAmount]);
  const customization = useMemo(() => ({
    visual: { style: { theme: "default" } },
    paymentMethods: { creditCard: "all", bankTransfer: "all" }
  }), []);

  async function submitPayment(payload) {
    setPaymentError("");
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer, selection, payment: payload })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao registrar pedido.");
    setPaymentResult(data);
    onFinished(data);
    return data;
  }

  async function handleMPSubmit({ selectedPaymentMethod, formData }) {
    try { return await submitPayment({ selectedPaymentMethod, formData }); }
    catch (e) { setPaymentError(e.message); throw e; }
  }

  async function handleSimulated() {
    try {
      await submitPayment({ selectedPaymentMethod: "pix", formData: { payment_method_id: "pix", payer: { email: "" } } });
    } catch (e) { setPaymentError(e.message); }
  }

  if (paymentResult) return <PaymentResult result={paymentResult} onNewOrder={onNewOrder} onBack={onBack} />;

  return (
    <main className="step-page">
      <div className="step-page-inner">
        <button type="button" className="ghost-button back-btn" onClick={onBack}>
          <ArrowLeft size={16} /> Voltar
        </button>

        <div className="payment-layout">
          <div className="step-card">
            <div className="section-title">
              <CreditCard size={22} />
              <div><h2>Pagamento</h2><p>Pix ou cartão de crédito em até 4x.</p></div>
            </div>

            {paymentError && <div className="error-box">{paymentError}</div>}

            {publicKey ? (
              <div className="mp-wrapper">
                {!brickReady && <div className="loading-box">Carregando...</div>}
                <Payment
                  key={`${order.totalCents}`}
                  initialization={initialization}
                  customization={customization}
                  onSubmit={handleMPSubmit}
                  onReady={() => setBrickReady(true)}
                  onError={(e) => setPaymentError(e?.message || "Erro no Mercado Pago.")}
                />
              </div>
            ) : (
              <div className="config-box">
                <h3>Modo de teste</h3>
                <p>Configure <strong>VITE_MP_PUBLIC_KEY</strong> e <strong>MP_ACCESS_TOKEN</strong> no .env para pagamentos reais.</p>
                <button type="button" className="primary-button" onClick={handleSimulated}>
                  <QrCode size={16} /> Registrar pedido teste
                </button>
              </div>
            )}
          </div>

          <aside className="payment-aside">
            <div className="step-card receipt-card">
              <h3>Resumo</h3>
              <OrderLines order={order} />
              <TotalRow order={order} />
              <div className="trust-badges">
                <span><ShieldCheck size={14} /> Pagamento seguro</span>
                <span><CreditCard size={14} /> Até 4x no cartão</span>
                <span><CheckCircle2 size={14} /> Confirmação imediata</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

/* ─── PAYMENT RESULT ─── */
function PaymentResult({ result, onNewOrder, onBack }) {
  const payment = result.payment || {};
  const pixData = payment.point_of_interaction?.transaction_data || {};
  const statusCopy = getStatusCopy(payment.status);

  return (
    <main className="step-page">
      <div className="step-page-inner">
        <div className="result-panel step-card">
          <div className="result-icon"><CheckCircle2 size={32} /></div>
          <p className="eyebrow">Pedido {result.orderId}</p>
          <h2>{statusCopy.title}</h2>
          <p>{statusCopy.description}</p>

          <div className="result-grid">
            <div><span>Status</span><strong>{payment.status || "registrado"}</strong></div>
            <div><span>Total</span><strong>{currency.format(result.order?.totalAmount || 0)}</strong></div>
            <div><span>Planilha</span><strong>{result.sheet?.enabled ? "Enviado" : "—"}</strong></div>
          </div>

          {pixData.qr_code_base64 && (
            <img className="pix-image" src={`data:image/png;base64,${pixData.qr_code_base64}`} alt="QR Code Pix" />
          )}
          {pixData.qr_code && (
            <div className="pix-copy">
              <label>Código Pix<textarea value={pixData.qr_code} readOnly rows={3} /></label>
              <button type="button" className="ghost-button" onClick={() => navigator.clipboard?.writeText(pixData.qr_code)}>
                <Copy size={15} /> Copiar
              </button>
            </div>
          )}
          {pixData.ticket_url && (
            <a className="ticket-link" href={pixData.ticket_url} target="_blank" rel="noreferrer">Abrir instrução de pagamento</a>
          )}

          <div className="result-actions">
            <button type="button" className="ghost-button" onClick={onBack}><ArrowLeft size={15} /> Revisar</button>
            <button type="button" className="primary-button" onClick={onNewOrder}><PackageCheck size={15} /> Novo pedido</button>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ─── HELPERS ─── */
function validateCustomer(c) {
  const msgs = [];
  if (c.name.trim().length < 3) msgs.push("Informe o nome.");
  if (c.phone.replace(/\D/g, "").length < 10) msgs.push("Informe um telefone válido.");
  return { valid: msgs.length === 0, messages: msgs };
}

function validateOrder(order) {
  const msgs = [];
  if (order.lines.length === 0) msgs.push("Selecione pelo menos um item.");
  return { valid: msgs.length === 0, messages: msgs };
}

function getStatusCopy(status) {
  const map = {
    approved: { title: "Pagamento aprovado!", description: "Pedido registrado e pagamento confirmado." },
    pending: { title: "Aguardando pagamento", description: "Conclua o pagamento pelo QR Code Pix." },
    in_process: { title: "Pagamento em análise", description: "O Mercado Pago está processando." },
    rejected: { title: "Pagamento recusado", description: "Tente outra forma de pagamento." },
    simulated: { title: "Pedido registrado (teste)", description: "Configure as credenciais para pagamentos reais." }
  };
  return map[status] || { title: "Pedido registrado", description: "Acompanhe pela planilha." };
}

function norm(value) {
  const q = Number.parseInt(value, 10);
  return !Number.isFinite(q) || q < 0 ? 0 : Math.min(q, 99);
}

function getProductSelectionQty(product, selection) {
  if (!selection) return 0;
  if (product.kind === "sizedVariants") {
    return product.variants.reduce((t, v) =>
      t + product.sizes.reduce((s, sz) => s + norm(selection.variants?.[v.code]?.[sz]), 0), 0);
  }
  if (product.kind === "modelQuantity") {
    return product.models.reduce((t, m) => t + norm(selection.models?.[m.code]), 0);
  }
  return norm(selection.quantity);
}



function getProductQty(product, order) {
  return order.lines
    .filter((l) => l.productId === product.id)
    .reduce((t, l) => t + l.quantity, 0);
}
