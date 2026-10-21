/**
 * SettingsModal.jsx — Ventana de configuración.
 *
 * Secciones:
 *  - Apariencia: tema y tamaño del texto del chat
 *  - Chat: tecla para enviar, fuentes desplegadas y detalles técnicos
 *  - Historial: borrar todo el historial (las fijadas se conservan)
 *  - Cuenta: datos del usuario y cerrar sesión
 *
 * Se cierra con la X, con Escape o al hacer clic fuera de la ventana.
 */
import { useEffect, useState } from "react";
import { X, Palette, MessagesSquare, History, UserRound, LogOut, Trash2 } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { usePreferencias } from "../lib/preferencias";

const SECCIONES = [
  { id: "apariencia", label: "Apariencia", Icon: Palette },
  { id: "chat", label: "Chat", Icon: MessagesSquare },
  { id: "historial", label: "Historial", Icon: History },
  { id: "cuenta", label: "Cuenta", Icon: UserRound },
];

const TEXTOS = [
  { id: "pequeno", label: "Pequeño" },
  { id: "normal", label: "Normal" },
  { id: "grande", label: "Grande" },
];

export default function SettingsModal({ abierto, onCerrar, perfil, historial, onCerrarSesion }) {
  const [seccion, setSeccion] = useState("apariencia");
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const { prefs, setPref } = usePreferencias();

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto, onCerrar]);

  useEffect(() => {
    if (!abierto) setConfirmarBorrado(false);
  }, [abierto]);

  if (!abierto) return null;

  const fijadas = historial.items.filter((h) => h.fijada).length;
  const sinFijar = historial.items.length - fijadas;

  async function borrarTodo() {
    setBorrando(true);
    await historial.borrar({ todas: true });
    setBorrando(false);
    setConfirmarBorrado(false);
  }

  return (
    <div style={styles.overlay} onMouseDown={onCerrar}>
      <div
        style={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Configuración"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={styles.header}>
          <h2 style={styles.title}>Configuración</h2>
          <button type="button" style={styles.closeBtn} onClick={onCerrar} title="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div style={styles.body}>
          {/* Menú de secciones */}
          <nav style={styles.tabs}>
            {SECCIONES.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                style={{ ...styles.tab, ...(seccion === id ? styles.tabActive : {}) }}
                onClick={() => setSeccion(id)}
              >
                <Icon size={15} /> <span>{label}</span>
              </button>
            ))}
          </nav>

          {/* Contenido */}
          <div style={styles.content}>
            {seccion === "apariencia" && (
              <>
                <Fila titulo="Tema" descripcion="Sistema usa el modo claro u oscuro de tu computadora.">
                  <ThemeToggle conTexto />
                </Fila>
                <Fila titulo="Tamaño del texto del chat" descripcion="Cambia el tamaño de las preguntas y respuestas.">
                  <Segmentado opciones={TEXTOS} valor={prefs.textoChat} onChange={(v) => setPref("textoChat", v)} />
                </Fila>
              </>
            )}

            {seccion === "chat" && (
              <>
                <Fila
                  titulo="Enviar con Enter"
                  descripcion={
                    prefs.enterEnvia
                      ? "Enter envía la consulta y Shift + Enter salta de línea."
                      : "Enter salta de línea y Ctrl + Enter envía la consulta."
                  }
                >
                  <Interruptor activo={prefs.enterEnvia} onChange={(v) => setPref("enterEnvia", v)} />
                </Fila>
                <Fila titulo="Mostrar fuentes desplegadas" descripcion="Las fuentes citadas aparecen abiertas debajo de cada respuesta.">
                  <Interruptor activo={prefs.fuentesAbiertas} onChange={(v) => setPref("fuentesAbiertas", v)} />
                </Fila>
                <Fila
                  titulo="Mostrar detalles técnicos"
                  descripcion="Modelo usado, tiempo de respuesta y porcentaje de similitud de cada fuente."
                >
                  <Interruptor activo={prefs.datosTecnicos} onChange={(v) => setPref("datosTecnicos", v)} />
                </Fila>
              </>
            )}

            {seccion === "historial" && (
              <>
                <Fila
                  titulo="Consultas guardadas"
                  descripcion={
                    historial.estado === "ok"
                      ? `${historial.items.length} en total, ${fijadas} fijada${fijadas === 1 ? "" : "s"}.`
                      : "No se pudo leer el historial."
                  }
                />
                <Fila
                  titulo="Borrar historial"
                  descripcion="Borra todas tus consultas. Las fijadas se conservan; para borrar una fijada, quítale la chincheta o elígela en la barra lateral."
                >
                  {!confirmarBorrado ? (
                    <button
                      type="button"
                      style={{ ...styles.dangerBtn, ...(sinFijar === 0 ? styles.btnDisabled : {}) }}
                      disabled={sinFijar === 0}
                      onClick={() => setConfirmarBorrado(true)}
                    >
                      <Trash2 size={13} /> Borrar
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" style={styles.dangerBtn} disabled={borrando} onClick={borrarTodo}>
                        {borrando ? "Borrando..." : `Borrar ${sinFijar}`}
                      </button>
                      <button type="button" style={styles.ghostBtn} disabled={borrando} onClick={() => setConfirmarBorrado(false)}>
                        Cancelar
                      </button>
                    </div>
                  )}
                </Fila>
                {historial.aviso && <p style={styles.notice}>{historial.aviso}</p>}
              </>
            )}

            {seccion === "cuenta" && (
              <>
                <Fila titulo="Nombre" descripcion={perfil.nombre || "Sin nombre registrado"} />
                <Fila titulo="Correo" descripcion={perfil.email} />
                <Fila titulo="Rol" descripcion="El rol lo asigna un administrador.">
                  <span style={styles.badge}>{perfil.rolNombre}</span>
                </Fila>
                <Fila titulo="Sesión" descripcion="Cierra la sesión en este navegador.">
                  <button type="button" style={styles.dangerBtn} onClick={onCerrarSesion}>
                    <LogOut size={13} /> Cerrar sesión
                  </button>
                </Fila>
              </>
            )}
          </div>
        </div>

        <p style={styles.footer}>IA Institucional · Módulo RAG de consultas académicas · Tecsup 2026</p>
      </div>
    </div>
  );
}

/* ── Piezas pequeñas ── */
function Fila({ titulo, descripcion, children }) {
  return (
    <div style={styles.row}>
      <div style={{ minWidth: 0 }}>
        <p style={styles.rowTitle}>{titulo}</p>
        {descripcion && <p style={styles.rowDesc}>{descripcion}</p>}
      </div>
      {children && <div style={{ flexShrink: 0 }}>{children}</div>}
    </div>
  );
}

function Interruptor({ activo, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      onClick={() => onChange(!activo)}
      style={{ ...styles.switch, ...(activo ? styles.switchOn : {}) }}
    >
      <span style={{ ...styles.knob, ...(activo ? styles.knobOn : {}) }} />
    </button>
  );
}

function Segmentado({ opciones, valor, onChange }) {
  return (
    <div style={styles.segment} role="radiogroup">
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={valor === o.id}
          onClick={() => onChange(o.id)}
          style={{ ...styles.segmentBtn, ...(valor === o.id ? styles.segmentBtnActive : {}) }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Estilos ── */
const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 300,
  },
  modal: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "calc(100svh - 32px)",
    display: "flex",
    flexDirection: "column",
    borderRadius: 14,
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    boxShadow: "0 20px 50px rgba(0,0,0,.3)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px 14px 20px",
    borderBottom: "1px solid var(--border)",
  },
  title: {
    fontSize: 16,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: "var(--text)",
  },
  body: {
    display: "flex",
    flexWrap: "wrap",
    minHeight: 340,
    overflowY: "auto",
  },
  tabs: {
    flex: "0 0 170px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 10,
    borderRight: "1px solid var(--border)",
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 8,
    background: "transparent",
    color: "var(--text)",
    fontSize: 13,
    fontWeight: 500,
    textAlign: "left",
  },
  tabActive: {
    background: "var(--accent-light)",
    color: "var(--accent)",
  },
  content: {
    flex: "1 1 300px",
    minWidth: 0,
    padding: "4px 20px 12px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "14px 0",
    borderBottom: "1px solid var(--border)",
  },
  rowTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-h)",
  },
  rowDesc: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 2,
    overflowWrap: "anywhere",
  },
  switch: {
    position: "relative",
    width: 38,
    height: 22,
    borderRadius: 11,
    background: "var(--border)",
    transition: "background-color .15s",
  },
  switchOn: {
    background: "var(--accent)",
  },
  knob: {
    position: "absolute",
    top: 3,
    left: 3,
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(0,0,0,.25)",
    transition: "transform .15s",
  },
  knobOn: {
    transform: "translateX(16px)",
  },
  segment: {
    display: "inline-flex",
    gap: 2,
    padding: 2,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
  },
  segmentBtn: {
    padding: "4px 10px",
    borderRadius: 6,
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: 12,
    fontWeight: 500,
  },
  segmentBtnActive: {
    background: "var(--bg-card)",
    color: "var(--accent)",
    boxShadow: "var(--shadow-sm)",
  },
  dangerBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid var(--danger)",
    background: "var(--danger-bg)",
    color: "var(--danger)",
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  ghostBtn: {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-h)",
    fontSize: 12,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  badge: {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 20,
    background: "var(--accent-light)",
    color: "var(--accent)",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "capitalize",
  },
  notice: {
    fontSize: 12,
    color: "var(--accent)",
    background: "var(--accent-light)",
    borderRadius: 6,
    padding: "8px 10px",
    marginTop: 12,
  },
  footer: {
    fontSize: 11,
    color: "var(--text-muted)",
    textAlign: "center",
    padding: "10px 16px",
    borderTop: "1px solid var(--border)",
  },
};
