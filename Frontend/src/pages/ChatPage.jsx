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
 */
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Bot, User, BookOpen, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { sendChatQuery, getAvailableModels } from "../services/api";

/* ── Mensaje de bienvenida ── */
const WELCOME = {
  id: "welcome",
  role: "assistant",
  content:
    "¡Hola! Soy la **IA Institucional**. Podés consultarme sobre los documentos académicos indexados en el sistema. ¿En qué te puedo ayudar?",
  sources: [],
};

export default function ChatPage() {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("qwen/qwen3-27b");
  const [expandedSources, setExpandedSources] = useState({});
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  /* Cargar modelos disponibles */
  useEffect(() => {
    getAvailableModels()
      .then((res) => {
        setModels(res.data.models ?? []);
      })
      .catch(() => {
        setModels([
          { id: "qwen/qwen3-27b", label: "Qwen 3 27B (Groq)" },
          { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (Groq)" },
        ]);
      });
  }, []);

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
      };
      setMessages((prev) => [...prev, assistantMsg]);
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

        {/* Selector de modelo */}
        <div style={styles.modelSelector}>
          <Sparkles size={12} color="var(--accent)" />
          <select
            style={styles.modelSelect}
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={loading}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

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
            placeholder="Escribí tu consulta... (Enter para enviar)"
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

        {/* Modelo usado */}
        {msg.model && (
          <p style={styles.modelLabel}>
            <Sparkles size={10} /> {msg.model}
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
