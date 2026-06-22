import { useState, useRef, useEffect } from 'react'

const AI_URL = import.meta.env.VITE_AI_URL || 'http://localhost:8000'
const AI_KEY = import.meta.env.VITE_AI_KEY || ''

/* ─── Estilos escopados — usa os tokens do design system ──────────────────
   --panel, --panel-2, --field, --line, --line-strong
   --text, --text-dim, --muted
   --green, --green-hover, --green-bright, --green-soft, --green-softer, --on-green
   --bg, --shadow, --shadow-sm, --r-sm, --r-md, --r-lg, --r-pill, --font
   Todos se adaptam automaticamente ao dark mode via .dark em :root.
──────────────────────────────────────────────────────────── */
const CSS = `
  .cw-fab {
    position: fixed;
    bottom: 28px;
    right: 28px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    font-family: var(--font);
  }

  /* ── Janela ── */
  .cw-window {
    width: 352px;
    height: 496px;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow);
    overflow: hidden;
    animation: cw-in .16s ease;
  }
  @keyframes cw-in {
    from { opacity: 0; transform: translateY(10px) scale(.98); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }

  /* ── Header ──
     --green   = grass-9  → cor sólida da marca, legível em ambos os modos
     --on-green = #fff (light) / #f0faf4 (dark) → garantido pelo Radix    */
  .cw-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 13px 14px;
    background: var(--green);
  }

  .cw-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .cw-avatar {
    width: 36px;
    height: 36px;
    border-radius: var(--r-sm);
    background: var(--green-soft);
    display: grid;
    place-items: center;
    font-size: 18px;
    flex-shrink: 0;
  }

  .cw-title {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--on-green);
    line-height: 1.2;
  }

  .cw-sub {
    font-size: 11px;
    color: var(--on-green);
    opacity: .72;
    margin-top: 2px;
    text-transform: uppercase;
    letter-spacing: .07em;
    font-weight: 600;
  }

  /* Botão fechar — usa panel-2 + line como o theme-btn do header do site */
  .cw-close {
    width: 30px;
    height: 30px;
    border-radius: var(--r-sm);
    background: var(--green-soft);
    border: none;
    color: var(--on-green);
    font-size: 13px;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: opacity .15s;
    flex-shrink: 0;
  }
  .cw-close:hover { opacity: .75; }

  /* ── Mensagens ── */
  .cw-msgs {
    flex: 1;
    overflow-y: auto;
    padding: 14px 12px 6px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    scrollbar-width: thin;
    scrollbar-color: var(--line) transparent;
  }

  .cw-msg {
    max-width: 84%;
    padding: 8px 12px;
    font-size: 13px;
    line-height: 1.5;
    border-radius: var(--r-md);
    word-break: break-word;
  }

  /* Bot: panel-2 (sage-3) + texto primário — mesmo padrão dos cards do site */
  .cw-msg.bot {
    align-self: flex-start;
    background: var(--panel-2);
    color: var(--text);
    border-bottom-left-radius: 4px;
  }

  /* Usuário: green (grass-9) + on-green — igual ao btn-primary do site */
  .cw-msg.user {
    align-self: flex-end;
    background: var(--green);
    color: var(--on-green);
    border-bottom-right-radius: 4px;
  }

  /* Typing: panel-2 + muted (sage-9) — texto de suporte */
  .cw-msg.typing {
    align-self: flex-start;
    background: var(--panel-2);
    color: var(--muted);
    border-bottom-left-radius: 4px;
    font-style: italic;
    font-size: 12px;
  }

  /* ── Form ── */
  .cw-form {
    flex-shrink: 0;
    display: flex;
    gap: 7px;
    padding: 10px 12px 13px;
    border-top: 1px solid var(--line);
  }

  /* Input: field (sage-3) + line border — igual ao .cart-form do site */
  .cw-input {
    flex: 1;
    background: var(--field);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    padding: 8px 14px;
    font-size: 13px;
    color: var(--text);
    outline: none;
    transition: border-color .15s;
  }
  .cw-input::placeholder { color: var(--muted); }
  .cw-input:focus        { border-color: var(--green-bright); }

  /* Botão: green + on-green — exato padrão .btn.btn-primary do site */
  .cw-send {
    background: var(--green);
    color: var(--on-green);
    border: none;
    border-radius: var(--r-pill);
    padding: 8px 15px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background .15s;
    white-space: nowrap;
  }
  .cw-send:hover:not(:disabled) { background: var(--green-hover); }

  /* ── Botão flutuante ──
     sage-12 → near-black em light, near-white em dark (padrão inverse Radix)
     sage-1  → inverso, garante contraste máximo em ambos os modos          */
  .cw-toggle {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: var(--r-pill);
    background: var(--sage-12);
    color: var(--sage-1);
    border: none;
    font-size: 22px;
    display: grid;
    place-items: center;
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    transition: transform .15s, box-shadow .15s;
  }
  .cw-toggle:hover { transform: scale(1.06); box-shadow: var(--shadow); }

  /* Badge verde — mesmo padrão do .cart-badge do site */
  .cw-badge {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--green);
    border: 2px solid var(--bg);
  }

  @media (max-width: 640px) {
    /* Sobe acima do bottom nav fixo (~70px) */
    .cw-fab {
      bottom: 82px;
      right: 12px;
    }
    /* Janela ocupa quase toda a largura da tela */
    .cw-window {
      width: calc(100vw - 24px);
      height: min(460px, calc(100dvh - 200px));
    }
  }
`

export default function ChatWidget() {
  const [aberto, setAberto]       = useState(false)
  const [msgs, setMsgs]           = useState([
    { de: 'bot', texto: 'Oi! Sou a assistente da Alcateia 🐺 Pergunte sobre produtos, preços ou a AASIAM!' },
  ])
  const [input, setInput]         = useState('')
  const [carregando, setCarregando] = useState(false)
  const fimRef = useRef(null)

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, carregando])

  async function enviar(e) {
    e.preventDefault()
    const pergunta = input.trim()
    if (!pergunta || carregando) return

    setMsgs(prev => [...prev, { de: 'user', texto: pergunta }])
    setInput('')
    setCarregando(true)

    try {
      const res  = await fetch(`${AI_URL}/perguntar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(AI_KEY && { 'X-API-Key': AI_KEY }) },
        body: JSON.stringify({ pergunta }),
      })
      const data = await res.json()
      setMsgs(prev => [...prev, { de: 'bot', texto: data.resposta }])
    } catch {
      setMsgs(prev => [...prev, { de: 'bot', texto: 'Ops, não consegui responder agora. Tente de novo!' }])
    } finally {
      setCarregando(false)
    }
  }

  return (
    <>
      <style>{CSS}</style>

      <div className="cw-fab">
        {aberto && (
          <div className="cw-window">

            <div className="cw-header">
              <div className="cw-header-left">
                <div className="cw-avatar">🐺</div>
                <div>
                  <div className="cw-title">Assistente AASIAM</div>
                  <div className="cw-sub">Alcateia · Sistemas AMF</div>
                </div>
              </div>
              <button className="cw-close" onClick={() => setAberto(false)} title="Fechar">✕</button>
            </div>

            <div className="cw-msgs">
              {msgs.map((m, i) => (
                <div key={i} className={`cw-msg ${m.de}`}>{m.texto}</div>
              ))}
              {carregando && <div className="cw-msg typing">Digitando…</div>}
              <div ref={fimRef} />
            </div>

            <form className="cw-form" onSubmit={enviar}>
              <input
                className="cw-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Pergunte sobre produtos…"
                disabled={carregando}
                autoComplete="off"
              />
              <button className="cw-send" type="submit" disabled={carregando || !input.trim()}>
                Enviar
              </button>
            </form>

          </div>
        )}

        <button
          className="cw-toggle"
          onClick={() => setAberto(v => !v)}
          title={aberto ? 'Fechar' : 'Falar com a Alcateia'}
        >
          {aberto ? '✕' : '🐺'}
          {!aberto && <span className="cw-badge" />}
        </button>
      </div>
    </>
  )
}
