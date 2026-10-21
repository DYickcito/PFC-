/**
 * App.jsx — Enrutador raíz de la aplicación.
 *
 * Flujo:
 *   Sin sesión          → <LoginPage />
 *   Con sesión + loading → pantalla de carga
 *   Con sesión          → <MainLayout /> (barra lateral + vista activa)
 *
 * Distribución de vistas por rol:
 *   admin    → puede ver "Ingesta" y "Chat"
 *   profesor → solo "Chat"
 *   alumno   → solo "Chat"
 */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./context/AuthContext";
import { supabase } from "./lib/supabaseClient";

import LoginPage  from "./pages/LoginPage";
import IngestPage from "./pages/IngestPage";
import ChatPage   from "./pages/ChatPage";
import Sidebar       from "./components/Sidebar";
import SettingsModal from "./components/SettingsModal";
import { useHistorial } from "./lib/historial";

/* ── Spinner de carga global ── */
function LoadingScreen() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100svh",
      gap: 16,
      color: "var(--text-muted)",
      fontSize: 14,
    }}>
      <div style={{
        width: 36, height: 36,
        border: "3px solid var(--border)",
        borderTopColor: "var(--accent)",
        borderRadius: "50%",
        animation: "spin .7s linear infinite",
      }} />
      Cargando...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ── Layout principal (post-login) ── */
const NOMBRES_ROL = { 1: "alumno", 2: "profesor", 3: "admin" };
const CLAVE_BARRA = "barra_lateral_abierta";

function useEsMovil() {
  const consulta = "(max-width: 768px)";
  const [esMovil, setEsMovil] = useState(() => window.matchMedia(consulta).matches);
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const alCambiar = (e) => setEsMovil(e.matches);
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, []);
  return esMovil;
}

function leerBarraAbierta() {
  try {
    return localStorage.getItem(CLAVE_BARRA) !== "false";
  } catch {
    return true;
  }
}

function MainLayout() {
  const { user, signOut } = useAuth();
  const [rolId, setRolId]         = useState(null);
  const [nombre, setNombre]       = useState("");
  const [activeTab, setActiveTab] = useState("chat");
  const [roleLoading, setRoleLoading] = useState(true);
  const esMovil = useEsMovil();
  const [barraEscritorio, setBarraEscritorio] = useState(leerBarraAbierta);
  const [barraMovil, setBarraMovil] = useState(false);
  const [configAbierta, setConfigAbierta] = useState(false);
  // Pedidos para el chat: abrir una consulta del historial o empezar una nueva
  const [consultaAbierta, setConsultaAbierta] = useState(null);
  const [nuevaConsulta, setNuevaConsulta] = useState(0);
  const historial = useHistorial();

  /*
   * Obtener el rol de negocio y el nombre desde Supabase.
   * Dependencia: user?.id (no `user` completo) → evita que el efecto
   * se reejecute cuando Supabase refresca el token de sesión y genera
   * un nuevo objeto `user` con el mismo ID, lo que antes reseteaba el tab.
   */
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("usuario")
      .select("rol_id, nombre, apellido")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        const id = data?.rol_id ?? 1;
        setRolId(id);
        setNombre([data?.nombre, data?.apellido].filter(Boolean).join(" "));
        // Solo establecer tab inicial la primera carga
        setActiveTab(id === 3 ? "ingest" : "chat");
        setRoleLoading(false);
      });
  }, [user?.id]); // <— solo dispara cuando CAMBIA el usuario, no en refrescos de token

  const barraAbierta = esMovil ? barraMovil : barraEscritorio;
  const toggleBarra = useCallback(
    (valor) => {
      if (esMovil) {
        setBarraMovil((v) => (typeof valor === "boolean" ? valor : !v));
        return;
      }
      setBarraEscritorio((v) => {
        const nuevo = typeof valor === "boolean" ? valor : !v;
        try {
          localStorage.setItem(CLAVE_BARRA, String(nuevo));
        } catch {
          /* sin localStorage la elección dura solo esta sesión */
        }
        return nuevo;
      });
    },
    [esMovil]
  );

  const cerrarConfig = useCallback(() => setConfigAbierta(false), []);

  if (roleLoading) return <LoadingScreen />;

  const isAdmin = rolId === 3;
  // Seguridad cliente: si no es admin e intenta ingest, forzar chat
  const safeTab = activeTab === "ingest" && !isAdmin ? "chat" : activeTab;
  const perfil = { nombre, email: user?.email, rolNombre: NOMBRES_ROL[rolId] ?? "alumno" };

  return (
    <div style={{ display: "flex", height: "100svh" }}>
      <Sidebar
        abierta={barraAbierta}
        esMovil={esMovil}
        onToggle={toggleBarra}
        activeTab={safeTab}
        onTabChange={setActiveTab}
        isAdmin={isAdmin}
        historial={historial}
        onAbrirConsulta={(c) => {
          setActiveTab("chat");
          setConsultaAbierta({ ...c, pedido: Date.now() });
        }}
        onNuevaConsulta={() => {
          setActiveTab("chat");
          setNuevaConsulta((n) => n + 1);
        }}
        onAbrirConfig={() => setConfigAbierta(true)}
        perfil={perfil}
        onCerrarSesion={signOut}
      />
      {/*
       * Ambas páginas se renderizan siempre (nunca se desmontan).
       * Solo se ocultan con CSS display:none cuando no están activas.
       * Esto preserva el estado interno de ChatPage (mensajes)
       * y de IngestPage (archivos pendientes) al cambiar de sección.
       */}
      <main style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        {isAdmin && (
          <div style={{ display: safeTab === "ingest" ? "flex" : "none", flex: 1, minHeight: 0, minWidth: 0 }}>
            <IngestPage />
          </div>
        )}
        <div style={{ display: safeTab === "chat" ? "flex" : "none", flex: 1, minHeight: 0, minWidth: 0 }}>
          <ChatPage
            consultaAbierta={consultaAbierta}
            nuevaConsulta={nuevaConsulta}
            onConsultaGuardada={historial.cargar}
          />
        </div>
      </main>
      <SettingsModal
        abierto={configAbierta}
        onCerrar={cerrarConfig}
        perfil={perfil}
        historial={historial}
        onCerrarSesion={signOut}
      />
    </div>
  );
}

/* ── Componente raíz ── */
export default function App() {
  const { session, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return session ? <MainLayout /> : <LoginPage />;
}
