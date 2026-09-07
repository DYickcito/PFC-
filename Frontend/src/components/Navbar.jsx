/**
 * Navbar.jsx — Barra de navegación superior.
 *
 * Contiene:
 *  - Tabs "Ingesta" (solo admin) y "Chat"
 *  - Nombre y email del usuario logueado
 *  - Botón de cerrar sesión
 */
import { useState, useEffect } from "react";
import { FileUp, MessageSquare, LogOut, User } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";

export default function Navbar({ activeTab, onTabChange }) {
  const { user, signOut } = useAuth();
  const [rolId, setRolId] = useState(null);
  const [userName, setUserName] = useState("");

  /* Obtener rol e info de usuario desde Supabase */
  useEffect(() => {
    if (!user) return;
    supabase
      .from("usuario")
      .select("rol_id, nombre, apellido")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setRolId(data.rol_id);
          setUserName(`${data.nombre} ${data.apellido}`);
        }
      });
  }, [user]);

  const isAdmin = rolId === 3;

  return (
    <nav style={styles.nav}>
      {/* ── Tabs ── */}
      <div style={styles.tabs}>
        {isAdmin && (
          <button
            style={{
              ...styles.tab,
              ...(activeTab === "ingest" ? styles.tabActive : {}),
            }}
            onClick={() => onTabChange("ingest")}
          >
            <FileUp size={15} />
            Ingesta
          </button>
        )}
        <button
          style={{
            ...styles.tab,
            ...(activeTab === "chat" ? styles.tabActive : {}),
          }}
          onClick={() => onTabChange("chat")}
        >
          <MessageSquare size={15} />
          Chat
        </button>
      </div>

      {/* ── Usuario + logout ── */}
      <div style={styles.userArea}>
        <div style={styles.userInfo}>
          <div style={styles.avatar}>
            <User size={14} />
          </div>
          <div style={styles.userText}>
            <span style={styles.userName}>{userName || "Usuario"}</span>
            <span style={styles.userEmail}>{user?.email}</span>
          </div>
        </div>
        <button style={styles.logoutBtn} onClick={signOut} title="Cerrar sesión">
          <LogOut size={15} />
        </button>
      </div>
    </nav>
  );
}

/* ── Estilos ── */
const styles = {
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 24px",
    height: 52,
    background: "var(--nav-bg)",
    borderBottom: "1px solid var(--nav-border)",
    position: "sticky",
    top: 0,
    zIndex: 100,
    flexShrink: 0,
  },
  tabs: {
    display: "flex",
    gap: 4,
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    borderRadius: 6,
    background: "transparent",
    color: "var(--text)",
    fontSize: 13,
    fontWeight: 500,
    transition: "all .15s",
    cursor: "pointer",
    border: "1px solid transparent",
  },
  tabActive: {
    background: "var(--accent-light)",
    color: "var(--accent)",
    border: "1px solid var(--accent-light)",
  },
  userArea: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "var(--accent-light)",
    color: "var(--accent)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  userText: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
  },
  userName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-h)",
    lineHeight: 1.2,
  },
  userEmail: {
    fontSize: 11,
    color: "var(--text-muted)",
    lineHeight: 1.2,
  },
  logoutBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 6,
    background: "transparent",
    color: "var(--text)",
    transition: "all .15s",
    border: "1px solid var(--border)",
    cursor: "pointer",
  },
};
