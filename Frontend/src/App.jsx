/**
 * App.jsx — Enrutador raíz de la aplicación.
 *
 * Flujo:
 *   Sin sesión          → <LoginPage />
 *   Con sesión + loading → pantalla de carga
 *   Con sesión          → <MainLayout /> (Navbar + vista activa)
 *
 * Distribución de vistas por rol:
 *   admin    → puede ver "Ingesta" y "Chat"
 *   profesor → solo "Chat"
 *   alumno   → solo "Chat"
 */
import { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext";
import { supabase } from "./lib/supabaseClient";

import LoginPage  from "./pages/LoginPage";
import IngestPage from "./pages/IngestPage";
import ChatPage   from "./pages/ChatPage";
import Navbar     from "./components/Navbar";

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
function MainLayout() {
  const { user } = useAuth();
  const [rolId, setRolId]         = useState(null);
  const [activeTab, setActiveTab] = useState("chat");
  const [roleLoading, setRoleLoading] = useState(true);

  /*
   * Obtener el rol de negocio desde Supabase.
   * Dependencia: user?.id (no `user` completo) → evita que el efecto
   * se reejcute cuando Supabase refresca el token de sesión y genera
   * un nuevo objeto `user` con el mismo ID, lo que antes reseteaba el tab.
   */
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("usuario")
      .select("rol_id")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        const id = data?.rol_id ?? 1;
        setRolId(id);
        // Solo establecer tab inicial la primera carga
        setActiveTab(id === 3 ? "ingest" : "chat");
        setRoleLoading(false);
      });
  }, [user?.id]); // <— solo dispara cuando CAMBIA el usuario, no en refrescos de token

  if (roleLoading) return <LoadingScreen />;

  const isAdmin = rolId === 3;
  // Seguridad cliente: si no es admin e intenta ingest, forzar chat
  const safeTab = activeTab === "ingest" && !isAdmin ? "chat" : activeTab;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh" }}>
      <Navbar activeTab={safeTab} onTabChange={setActiveTab} />
      {/*
       * Ambas páginas se renderizan siempre (nunca se desmontan).
       * Solo se ocultan con CSS display:none cuando no están activas.
       * Esto preserva el estado interno de ChatPage (historial de mensajes)
       * y de IngestPage (archivos pendientes) al cambiar de tab.
       */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        {isAdmin && (
          <div style={{ display: safeTab === "ingest" ? "flex" : "none", flex: 1, minHeight: 0 }}>
            <IngestPage />
          </div>
        )}
        <div style={{ display: safeTab === "chat" ? "flex" : "none", flex: 1, minHeight: 0 }}>
          <ChatPage />
        </div>
      </div>
    </div>
  );
}

/* ── Componente raíz ── */
export default function App() {
  const { session, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return session ? <MainLayout /> : <LoginPage />;
}
