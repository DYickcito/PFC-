/**
 * Sidebar.jsx — Barra lateral izquierda.
 *
 * Contiene:
 *  - Botón para plegar o desplegar la barra (se recuerda la elección)
 *  - "Nueva consulta" y las secciones Chat e Ingesta (Ingesta solo admin)
 *  - Historial de consultas: abrir, fijar y borrar las elegidas
 *  - Perfil abajo, con menú para abrir la configuración o cerrar sesión
 *
 * Plegada queda una columna angosta con íconos. En pantallas pequeñas se
 * abre por encima del contenido y se cierra al tocar fuera.
 */
import { useEffect, useRef, useState } from "react";
import {
  PanelLeftClose, PanelLeftOpen, MessageSquarePlus, MessageSquare, FileUp, History,
  ListChecks, Pin, PinOff, Trash2, Square, SquareCheck, Settings, LogOut, ChevronsUpDown,
  GraduationCap,
} from "lucide-react";

function formatFecha(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function iniciales(nombre, email) {
  const base = (nombre || "").trim() || (email || "?");
  const partes = base.split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function Sidebar({
  abierta,
  esMovil,
  onToggle,
  activeTab,
  onTabChange,
  isAdmin,
  historial,
  onAbrirConsulta,
  onNuevaConsulta,
  onAbrirConfig,
  perfil,
  onCerrarSesion,
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState({});
  const [confirmar, setConfirmar] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [menuPerfil, setMenuPerfil] = useState(false);
  const menuRef = useRef(null);

  const { items, estado, error, aviso } = historial;
  const selectedCount = Object.keys(selected).length;
  const allSelected = items.length > 0 && selectedCount === items.length;

  /* Cerrar el menú del perfil al hacer clic fuera */
  useEffect(() => {
    if (!menuPerfil) return;
    const alClic = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuPerfil(false);
    };
    document.addEventListener("mousedown", alClic);
    return () => document.removeEventListener("mousedown", alClic);
  }, [menuPerfil]);

  function salirDeSeleccion() {
    setSelectMode(false);
    setSelected({});
    setConfirmar(false);
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  async function borrarElegidas() {
    setBorrando(true);
    const ok = await historial.borrar({ ids: Object.keys(selected) });
    setBorrando(false);
    if (ok) salirDeSeleccion();
    else setConfirmar(false);
  }

  /* En móvil, elegir algo cierra la barra */
  function despues(accion) {
    return (...args) => {
      accion(...args);
      if (esMovil) onToggle(false);
    };
  }

  /* ── Barra plegada: columna de íconos ── */
  if (!abierta) {
    return (
      <aside style={styles.rail}>
        <button type="button" style={styles.railBtn} onClick={() => onToggle(true)} title="Mostrar barra lateral">
          <PanelLeftOpen size={18} />
        </button>
        <button type="button" style={styles.railBtn} onClick={onNuevaConsulta} title="Nueva consulta">
          <MessageSquarePlus size={18} />
        </button>
        <button
          type="button"
          style={{ ...styles.railBtn, ...(activeTab === "chat" ? styles.railBtnActive : {}) }}
          onClick={() => onTabChange("chat")}
          title="Chat"
        >
          <MessageSquare size={18} />
        </button>
        {isAdmin && (
          <button
            type="button"
            style={{ ...styles.railBtn, ...(activeTab === "ingest" ? styles.railBtnActive : {}) }}
            onClick={() => onTabChange("ingest")}
            title="Ingesta de documentos"
          >
            <FileUp size={18} />
          </button>
        )}
        <button type="button" style={styles.railBtn} onClick={() => onToggle(true)} title="Ver historial">
          <History size={18} />
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" style={styles.railBtn} onClick={onAbrirConfig} title="Configuración">
          <Settings size={18} />
        </button>
        <button type="button" style={styles.railAvatar} onClick={onAbrirConfig} title={perfil.nombre || perfil.email}>
          {iniciales(perfil.nombre, perfil.email)}
        </button>
      </aside>
    );
  }

  /* ── Barra desplegada ── */
  return (
    <>
      {esMovil && <div style={styles.backdrop} onClick={() => onToggle(false)} />}
      <aside style={{ ...styles.panel, ...(esMovil ? styles.panelMovil : {}) }}>
        {/* Encabezado */}
        <div style={styles.top}>
          <div style={styles.brand}>
            <div style={styles.logo}>
              <GraduationCap size={16} />
            </div>
            <span style={styles.brandText}>IA Institucional</span>
          </div>
          <button type="button" style={styles.iconBtn} onClick={() => onToggle(false)} title="Ocultar barra lateral">
            <PanelLeftClose size={16} />
          </button>
        </div>

        {/* Acciones y secciones */}
        <div style={styles.nav}>
          <button type="button" style={styles.newBtn} onClick={despues(onNuevaConsulta)}>
            <MessageSquarePlus size={15} /> Nueva consulta
          </button>
          <button
            type="button"
            style={{ ...styles.navItem, ...(activeTab === "chat" ? styles.navItemActive : {}) }}
            onClick={despues(() => onTabChange("chat"))}
          >
            <MessageSquare size={15} /> Chat
          </button>
          {isAdmin && (
            <button
              type="button"
              style={{ ...styles.navItem, ...(activeTab === "ingest" ? styles.navItemActive : {}) }}
              onClick={despues(() => onTabChange("ingest"))}
            >
              <FileUp size={15} /> Ingesta de documentos
            </button>
          )}
        </div>

        {/* Historial */}
        <div style={styles.sectionHead}>
          <span style={styles.sectionTitle}>Historial</span>
          {estado === "ok" && items.length > 0 && !selectMode && (
            <button type="button" style={styles.iconBtnSmall} onClick={() => setSelectMode(true)} title="Elegir consultas para borrar">
              <ListChecks size={14} />
            </button>
          )}
        </div>

        {selectMode && (
          <div style={styles.selectBar}>
            {confirmar ? (
              <>
                <span style={styles.selectText}>
                  ¿Borrar {selectedCount} consulta{selectedCount === 1 ? "" : "s"}?
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" style={styles.dangerBtn} disabled={borrando} onClick={borrarElegidas}>
                    {borrando ? "Borrando..." : "Borrar"}
                  </button>
                  <button type="button" style={styles.smallBtn} disabled={borrando} onClick={() => setConfirmar(false)}>
                    No
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  style={styles.linkBtn}
                  onClick={() => setSelected(allSelected ? {} : Object.fromEntries(items.map((h) => [h.id, true])))}
                >
                  {allSelected ? "Ninguna" : "Todas"}
                </button>
                <span style={styles.selectText}>{selectedCount} elegida{selectedCount === 1 ? "" : "s"}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    style={{ ...styles.dangerBtn, ...(selectedCount === 0 ? styles.btnDisabled : {}) }}
                    disabled={selectedCount === 0}
                    onClick={() => setConfirmar(true)}
                    title="Borrar las consultas elegidas"
                  >
                    <Trash2 size={12} />
                  </button>
                  <button type="button" style={styles.smallBtn} onClick={salirDeSeleccion}>
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div style={styles.list}>
          {aviso && <p style={styles.notice}>{aviso}</p>}
          {estado === "loading" && <p style={styles.empty}>Cargando...</p>}
          {estado === "error" && <p style={styles.empty}>{error}</p>}
          {estado === "ok" && items.length === 0 && (
            <p style={styles.empty}>Todavía no tienes consultas guardadas.</p>
          )}
          {estado === "ok" &&
            items.map((c, i) => {
              const showPinnedLabel = c.fijada && i === 0;
              const showRecentLabel = !c.fijada && i > 0 && items[i - 1].fijada;
              const isSelected = !!selected[c.id];
              return (
                <div key={c.id} style={{ display: "contents" }}>
                  {showPinnedLabel && <p style={styles.group}>Fijadas</p>}
                  {showRecentLabel && <p style={styles.group}>Recientes</p>}
                  <div
                    className="sidebar-item"
                    style={{ ...styles.item, ...(isSelected ? styles.itemSelected : {}) }}
                  >
                    <button
                      type="button"
                      style={styles.itemMain}
                      onClick={() => (selectMode ? toggleSelected(c.id) : despues(onAbrirConsulta)(c))}
                      title={selectMode ? "Elegir esta consulta" : `${c.pregunta}\n${formatFecha(c.fecha)}`}
                    >
                      {selectMode && (
                        <span style={{ color: isSelected ? "var(--accent)" : "var(--text-muted)", flexShrink: 0, display: "flex" }}>
                          {isSelected ? <SquareCheck size={14} /> : <Square size={14} />}
                        </span>
                      )}
                      <span style={styles.itemText}>{c.pregunta}</span>
                    </button>
                    {!selectMode && (
                      <button
                        type="button"
                        className={c.fijada ? "" : "sidebar-pin"}
                        style={{ ...styles.pinBtn, ...(c.fijada ? styles.pinBtnActive : {}) }}
                        onClick={() => historial.fijar(c)}
                        title={c.fijada ? "Quitar de fijadas" : "Fijar arriba"}
                      >
                        {c.fijada ? <PinOff size={13} /> : <Pin size={13} />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Perfil */}
        <div style={styles.footer} ref={menuRef}>
          {menuPerfil && (
            <div style={styles.menu}>
              <button
                type="button"
                style={styles.menuItem}
                onClick={() => {
                  setMenuPerfil(false);
                  onAbrirConfig();
                }}
              >
                <Settings size={14} /> Configuración
              </button>
              <button type="button" style={{ ...styles.menuItem, color: "var(--danger)" }} onClick={onCerrarSesion}>
                <LogOut size={14} /> Cerrar sesión
              </button>
            </div>
          )}
          <button type="button" style={styles.profile} onClick={() => setMenuPerfil((v) => !v)} title="Opciones de la cuenta">
            <span style={styles.avatar}>{iniciales(perfil.nombre, perfil.email)}</span>
            <span style={styles.profileText}>
              <span style={styles.profileName}>{perfil.nombre || "Usuario"}</span>
              <span style={styles.profileEmail}>{perfil.rolNombre} · {perfil.email}</span>
            </span>
            <ChevronsUpDown size={14} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
          </button>
        </div>
      </aside>

      {/* El pin aparece al pasar el mouse; las fijadas lo muestran siempre */}
      <style>{`
        .sidebar-item:hover { background: var(--bg); }
        .sidebar-item .sidebar-pin { opacity: 0; }
        .sidebar-item:hover .sidebar-pin, .sidebar-pin:focus-visible { opacity: 1; }
        @media (hover: none) { .sidebar-item .sidebar-pin { opacity: 1; } }
      `}</style>
    </>
  );
}

/* ── Estilos ── */
const styles = {
  /* Plegada */
  rail: {
    width: 56,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    padding: "10px 0",
    background: "var(--bg-sidebar)",
    borderRight: "1px solid var(--border)",
  },
  railBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: "var(--text)",
  },
  railBtnActive: {
    background: "var(--accent-light)",
    color: "var(--accent)",
  },
  railAvatar: {
    width: 32,
    height: 32,
    marginTop: 4,
    borderRadius: "50%",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
  },

  /* Desplegada */
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.4)",
    zIndex: 199,
  },
  panel: {
    width: 272,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    background: "var(--bg-sidebar)",
    borderRight: "1px solid var(--border)",
  },
  panelMovil: {
    position: "fixed",
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 200,
    boxShadow: "var(--shadow)",
  },
  top: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 12px 8px 14px",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: "var(--accent-light)",
    color: "var(--accent)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  brandText: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text-h)",
    whiteSpace: "nowrap",
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: "var(--text)",
  },
  iconBtnSmall: {
    width: 24,
    height: 24,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: "var(--text-muted)",
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "4px 10px 8px",
  },
  newBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    marginBottom: 6,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text-h)",
    fontSize: 13,
    fontWeight: 600,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderRadius: 8,
    background: "transparent",
    color: "var(--text)",
    fontSize: 13,
    fontWeight: 500,
    textAlign: "left",
  },
  navItemActive: {
    background: "var(--accent-light)",
    color: "var(--accent)",
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px 4px 20px",
    borderTop: "1px solid var(--border)",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".05em",
    color: "var(--text-muted)",
  },
  selectBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    margin: "4px 10px",
    padding: "6px 8px",
    borderRadius: 8,
    background: "var(--bg)",
    border: "1px solid var(--border)",
  },
  selectText: {
    fontSize: 12,
    color: "var(--text)",
  },
  linkBtn: {
    background: "transparent",
    color: "var(--accent)",
    fontSize: 12,
    fontWeight: 600,
    padding: 0,
  },
  smallBtn: {
    padding: "3px 8px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-h)",
    fontSize: 12,
  },
  dangerBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 8px",
    borderRadius: 6,
    border: "1px solid var(--danger)",
    background: "var(--danger-bg)",
    color: "var(--danger)",
    fontSize: 12,
    fontWeight: 600,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "2px 10px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 1,
    minHeight: 0,
  },
  group: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".05em",
    color: "var(--text-muted)",
    padding: "8px 10px 2px",
  },
  notice: {
    fontSize: 11,
    color: "var(--accent)",
    background: "var(--accent-light)",
    borderRadius: 6,
    padding: "6px 10px",
    textAlign: "center",
    marginBottom: 4,
  },
  empty: {
    fontSize: 12,
    color: "var(--text-muted)",
    textAlign: "center",
    padding: "16px 10px",
  },
  item: {
    display: "flex",
    alignItems: "center",
    borderRadius: 8,
    flexShrink: 0,
  },
  itemSelected: {
    background: "var(--accent-light)",
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 4px 7px 10px",
    background: "transparent",
    color: "var(--text-h)",
    textAlign: "left",
  },
  itemText: {
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pinBtn: {
    width: 26,
    height: 26,
    marginRight: 4,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    color: "var(--text-muted)",
    flexShrink: 0,
  },
  pinBtnActive: {
    color: "var(--accent)",
  },
  footer: {
    position: "relative",
    padding: 10,
    borderTop: "1px solid var(--border)",
  },
  menu: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: "calc(100% - 4px)",
    padding: 4,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    boxShadow: "var(--shadow)",
    display: "flex",
    flexDirection: "column",
    zIndex: 10,
  },
  menuItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 6,
    background: "transparent",
    color: "var(--text-h)",
    fontSize: 13,
    textAlign: "left",
  },
  profile: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 8px",
    borderRadius: 8,
    background: "transparent",
    textAlign: "left",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  profileText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  profileName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-h)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  profileEmail: {
    fontSize: 11,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
