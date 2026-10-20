/**
 * ChatPage.jsx — Vista de consultas RAG.
 *
 * Accesible para todos los roles (alumno, profesor, admin).
 *
 * Características:
 *  - Historial de mensajes (usuario / IA)
 *  - Selector de modelo LLM
 *  - Input con envío por Enter o botón
 *  - Renderizado de Markdown en las respuestas
 *  - Panel de fuentes citadas en cada respuesta
 *  - Indicador de origen: documentos oficiales o conocimiento general
 *    (según el enrutamiento por puntaje de similitud del backend)
 *  - Panel de historial con las consultas anteriores del usuario
 *    (tabla `consulta` de Supabase, vía GET /api/v1/chat/history)
 */
import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Bot, User, BookOpen, ChevronDown, ChevronUp, Sparkles, ShieldCheck, Info, History, X, MessageSquarePlus } from "lucide-react";
import { sendChatQuery, getAvailableModels, getChatHistory } from "../services/api";

/* ── Mensaje de bienvenida ── */
const WELCOME = {
  id: "welcome",
  role: "assistant",
  content:
    "¡Hola! Soy la **IA Institucional**. Puedes consultarme sobre los documentos académicos indexados en el sistema. ¿En qué te puedo ayudar?",
  sources: [],
};

function formatFecha(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function ChatPage() {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [expandedSources, setExpandedSources] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyState, setHistoryState] = useState("idle"); // idle | loading | ok | error
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  /* Cargar modelos disponibles */
  useEffect(() => {
    getAvailableModels()
      .then((res) => {
        const list = res.data.models ?? [];
        setModels(list);
        setSelectedModel(res.data.default ?? list[0]?.id ?? "");
      })
      .catch(() => {
        // Sin lista de modelos el backend usa su modelo por defecto
        setModels([]);
      });
  }, []);

  /* Historial de consultas del usuario */
  const loadHistory = useCallback(async () => {
    setHistoryState((prev) => (prev === "ok" ? "ok" : "loading"));
    try {
      const res = await getChatHistory(30);
      setHistory(res.data.consultas ?? []);
      setHistoryState("ok");
    } catch {
      setHistoryState("error");
    }
  }, []);

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory, loadHistory]);

  /* Mostrar en el chat una consulta anterior */
  function openFromHistory(c) {
    setMessages((prev) => [
      ...prev,
      { id: `h-${c.id}-q`, role: "user", content: c.pregunta, fromHistory: c.fecha },
      {
        id: `h-${c.id}-a`,
        role: "assistant",
        content: c.respuesta,
        sources: [],
        model: c.modelo,
        usoContexto: c.uso_contexto,
        tiempoMs: c.tiempo_ms,
        fromHistory: c.fecha,
      },
    ]);
  }

  function newConversation() {
    setMessages([WELCOME]);
    setExpandedSources({});
    inputRef.current?.focus();
  }

  /* Auto-scroll al último mensaje */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  /* Enviar mensaje */
  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { id: Date.now(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await sendChatQuery(text, selectedModel, 5);
      const data = res.data;
      const assistantMsg = {
        id: Date.now() + 1,
        role: "assistant",
        content: data.response,
        sources: data.sources ?? [],
        model: data.model_used,
        usoContexto: data.uso_contexto,
        maxScore: data.max_score,
        tiempoMs: data.tiempo_ms,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      // El backend guarda la consulta en segundo plano; se refresca el panel poco después
      if (showHistory) setTimeout(loadHistory, 1500);
    } catch (err) {
      const detail = err.response?.data?.detail ?? "Error al conectar con el servidor.";
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "error",
          content: `⚠️ ${detail}`,
          sources: [],
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function toggleSources(id) {
    setExpandedSources((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div style={styles.page}>
      {/* ── Encabezado ── */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.botIcon}>
            <Bot size={18} color="var(--accent)" />
          </div>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-h)" }}>
              Asistente Institucional
            </h2>
            <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Consultas sobre documentos académicos
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          style={styles.headerBtn}
          onClick={newConversation}
          disabled={loading}
          title="Limpiar el chat y empezar una conversación nueva"
        >
          <MessageSquarePlus size={13} /> Nueva
        </button>
        <button
          type="button"
          style={{ ...styles.headerBtn, ...(showHistory ? styles.headerBtnActive : {}) }}
          onClick={() => setShowHistory((v) => !v)}
          title="Ver tus consultas anteriores"
        >
          <History size={13} /> Historial
        </button>

        {/* Selector de modelo */}
        <div style={styles.modelSelector}>
          <Sparkles size={12} color="var(--accent)" />
          <select
            style={styles.modelSelect}
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={loading || models.length === 0}
          >
            {models.length === 0 && <option value="">Modelo por defecto</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        </div>
      </div>

      <div style={styles.body}>
      <div style={styles.chatCol}>
      {/* ── Área de mensajes ── */}
      <div style={styles.messages}>
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            expanded={expandedSources[msg.id]}
            onToggleSources={() => toggleSources(msg.id)}
          />
        ))}

        {/* Indicador de escritura */}
        {loading && (
          <div style={{ ...styles.bubble, ...styles.bubbleAssistant }}>
            <div style={styles.avatarAssistant}>
              <Bot size={14} color="var(--accent)" />
            </div>
            <div style={styles.typingDots}>
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div style={styles.inputArea}>
        <div style={styles.inputWrapper}>
          <textarea
            ref={inputRef}
            style={styles.textarea}
            rows={1}
            placeholder="Escribe tu consulta... (Enter para enviar)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            style={{
              ...styles.sendBtn,
              ...((!input.trim() || loading) ? styles.sendBtnDisabled : {}),
            }}
            onClick={handleSend}
            disabled={!input.trim() || loading}
            title="Enviar"
          >
            <Send size={16} />
          </button>
        </div>
        <p style={styles.hint}>
          Shift + Enter para nueva línea · Respuestas basadas en documentos indexados
        </p>
      </div>
      </div>

      {/* ── Panel de historial ── */}
      {showHistory && (
        <aside style={styles.historyPanel}>
          <div style={styles.historyHeader}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-h)" }}>Tus consultas anteriores</span>
            <button type="button" style={styles.iconBtn} onClick={() => setShowHistory(false)} title="Cerrar historial">
              <X size={14} />
            </button>
          </div>
          <div style={styles.historyList}>
            {historyState === "loading" && <p style={styles.historyEmpty}>Cargando...</p>}
            {historyState === "error" && (
              <p style={styles.historyEmpty}>No se pudo cargar el historial. Revisa que exista la tabla consulta en Supabase.</p>
            )}
            {historyState === "ok" && history.length === 0 && (
              <p style={styles.historyEmpty}>Todavía no tienes consultas guardadas.</p>
            )}
            {historyState === "ok" && history.map((c) => (
              <button key={c.id} type="button" style={styles.historyItem} onClick={() => openFromHistory(c)} title="Mostrar esta consulta en el chat">
                <span style={styles.historyQuestion}>{c.pregunta}</span>
                <span style={styles.historyMeta}>
                  <span style={{ color: c.uso_contexto ? "var(--success)" : "var(--warning)", fontWeight: 600 }}>
                    {c.uso_contexto ? "Documentos" : "General"}
                  </span>
                  {" · "}{formatFecha(c.fecha)}
                </span>
              </button>
            ))}
          </div>
        </aside>
      )}
      </div>

      {/* Keyframes para spinner y dots */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink {
          0%, 80%, 100% { opacity: 0; transform: scale(.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

/* ── Burbuja de mensaje individual ── */
function MessageBubble({ msg, expanded, onToggleSources }) {
  const isUser = msg.role === "user";
  const isError = msg.role === "error";

  if (isUser) {
    return (
      <div style={{ ...styles.bubble, ...styles.bubbleUser }}>
        <div style={styles.userText}>{msg.content}</div>
        <div style={styles.avatarUser}>
          <User size={14} color="#fff" />
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.bubble, ...styles.bubbleAssistant }}>
      <div style={{ ...(isError ? styles.avatarError : styles.avatarAssistant) }}>
        <Bot size={14} color={isError ? "var(--danger)" : "var(--accent)"} />
      </div>
      <div style={styles.assistantContent}>
        {/* Contenido markdown */}
        <div style={{ ...styles.markdownWrapper, ...(isError ? styles.errorText : {}) }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
        </div>

        {/* Origen de la respuesta */}
        {msg.usoContexto === true && (
          <p style={{ ...styles.originTag, ...styles.originDocs }}>
            <ShieldCheck size={11} /> Basada en documentos oficiales
          </p>
        )}
        {msg.usoContexto === false && (
          <p style={{ ...styles.originTag, ...styles.originGeneral }}>
            <Info size={11} /> Sin información en los documentos cargados
          </p>
        )}

        {/* Consulta recuperada del historial */}
        {msg.fromHistory && (
          <p style={{ ...styles.modelLabel, marginRight: 6 }}>
            <History size={10} /> Del historial · {formatFecha(msg.fromHistory)}
          </p>
        )}

        {/* Modelo usado y tiempo */}
        {msg.model && (
          <p style={styles.modelLabel}>
            <Sparkles size={10} /> {msg.model}
            {msg.tiempoMs != null && ` · ${(msg.tiempoMs / 1000).toFixed(1)} s`}
          </p>
        )}

        {/* Fuentes */}
        {msg.sources?.length > 0 && (
          <div style={styles.sourcesWrapper}>
            <button style={styles.sourcesToggle} onClick={onToggleSources}>
              <BookOpen size={12} />
              {msg.sources.length} fuente{msg.sources.length > 1 ? "s" : ""} citada{msg.sources.length > 1 ? "s" : ""}
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
            {expanded && (
              <div style={styles.sourcesList}>
                {msg.sources.map((s, i) => (
                  <div key={i} style={styles.sourceCard}>
                    <div style={styles.sourceHeader}>
                      <span style={styles.sourceName}>{s.nombre_documento || "Documento"}</span>
                      {s.score != null && (
                        <span style={styles.scoreTag}>
                          {(s.score * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <p style={styles.sourceSnippet}>"{s.texto_fragmento}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════ ESTILOS ════════════════════════════════════════ */
const styles = {
  page: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
  },

  /* Encabezado */
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 24px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-card)",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  botIcon: {
    width: 36, height: 36,
    borderRadius: 10,
    background: "var(--accent-light)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modelSelector: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
  },
  modelSelect: {
    background: "transparent",
    border: "none",
    color: "var(--text-h)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    outline: "none",
  },

  /* Botones del encabezado */
  headerBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text-h)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  headerBtnActive: {
    borderColor: "var(--accent)",
    background: "var(--accent-light)",
    color: "var(--accent)",
  },
  iconBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
  },

  /* Cuerpo: chat + panel de historial */
  body: {
    flex: 1,
    display: "flex",
    minHeight: 0,
  },
  chatCol: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  },
  historyPanel: {
    width: 300,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderLeft: "1px solid var(--border)",
    background: "var(--bg-card)",
    minHeight: 0,
  },
  historyHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
  },
  historyList: {
    flex: 1,
    overflowY: "auto",
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  historyEmpty: {
    fontSize: 12,
    color: "var(--text-muted)",
    textAlign: "center",
    padding: "20px 10px",
  },
  historyItem: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    cursor: "pointer",
  },
  historyQuestion: {
    fontSize: 12,
    color: "var(--text-h)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  historyMeta: {
    fontSize: 10,
    color: "var(--text-muted)",
  },

  /* Mensajes */
  messages: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },

  bubble: {
    display: "flex",
    gap: 10,
    maxWidth: "85%",
    minWidth: 0,
    boxSizing: "border-box",
  },
  bubbleUser: {
    alignSelf: "flex-end",
    flexDirection: "row-reverse",
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
  },

  avatarUser: {
    width: 30, height: 30,
    borderRadius: "50%",
    background: "var(--accent)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  avatarAssistant: {
    width: 30, height: 30,
    borderRadius: "50%",
    background: "var(--accent-light)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  avatarError: {
    width: 30, height: 30,
    borderRadius: "50%",
    background: "var(--danger-bg)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },

  userText: {
    padding: "10px 14px",
    borderRadius: "16px 4px 16px 16px",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 13,
    lineHeight: 1.5,
    maxWidth: "100%",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
  },

  assistantContent: {
    flex: 1,
    minWidth: 0,
    maxWidth: "100%",
  },
  markdownWrapper: {
    padding: "10px 14px",
    borderRadius: "4px 16px 16px 16px",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-h)",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    overflowX: "auto",
  },
  errorText: {
    background: "var(--danger-bg)",
    borderColor: "var(--danger)",
    color: "var(--danger)",
  },

  modelLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    color: "var(--text-muted)",
    marginTop: 5,
    marginLeft: 4,
  },

  /* Origen de la respuesta */
  originTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    fontWeight: 600,
    borderRadius: 4,
    padding: "2px 7px",
    marginTop: 6,
    marginLeft: 4,
    marginRight: 6,
  },
  originDocs: {
    color: "var(--success)",
    background: "var(--success-bg)",
  },
  originGeneral: {
    color: "var(--warning)",
    background: "var(--warning-bg)",
  },

  /* Fuentes */
  sourcesWrapper: {
    marginTop: 8,
    marginLeft: 4,
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
  },
  sourcesToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
  },
  sourcesList: {
    marginTop: 6,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
  },
  sourceCard: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    overflow: "hidden",
  },
  sourceHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    gap: 8,
    minWidth: 0,
  },
  sourceName: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-h)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  scoreTag: {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--success)",
    background: "var(--success-bg)",
    padding: "1px 6px",
    borderRadius: 4,
    flexShrink: 0,
  },
  sourceSnippet: {
    fontSize: 11,
    color: "var(--text)",
    lineHeight: 1.5,
    fontStyle: "italic",
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    wordBreak: "break-all",
    overflowWrap: "anywhere",
  },

  /* Typing dots */
  typingDots: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "12px 16px",
    borderRadius: "4px 16px 16px 16px",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
  },

  /* Input area */
  inputArea: {
    padding: "12px 24px 16px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-card)",
    flexShrink: 0,
  },
  inputWrapper: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "var(--bg)",
    padding: "6px 6px 6px 14px",
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: "none",
    background: "transparent",
    color: "var(--text-h)",
    fontSize: 13,
    lineHeight: 1.5,
    outline: "none",
    minHeight: 24,
    maxHeight: 120,
    overflowY: "auto",
  },
  sendBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: 8,
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    cursor: "pointer",
    flexShrink: 0,
    transition: "background .15s",
  },
  sendBtnDisabled: {
    background: "var(--border)",
    color: "var(--text-muted)",
    cursor: "not-allowed",
  },
  hint: {
    fontSize: 10,
    color: "var(--text-muted)",
    textAlign: "center",
    marginTop: 6,
  },
};
