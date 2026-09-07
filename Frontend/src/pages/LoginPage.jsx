/**
 * LoginPage.jsx — Vista de autenticación.
 *
 * Dos modos: Iniciar sesión / Registrarse.
 * Usa Supabase Auth directamente.
 * El registro incluye nombre, apellido, email y contraseña.
 */
import { useState } from "react";
import { LogIn, UserPlus, Eye, EyeOff, GraduationCap } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

export default function LoginPage() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [form, setForm] = useState({ nombre: "", apellido: "", email: "", password: "" });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null); // { type: "success"|"error", text }

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setMessage(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (error) throw error;
        // El AuthContext detecta el cambio de sesión y redirige automáticamente
      } else {
        // Registro: Supabase crea el usuario en auth.users y el trigger
        // handle_new_user() inserta en la tabla `usuario` con los metadatos.
        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            data: {
              nombre: form.nombre.trim(),
              apellido: form.apellido.trim(),
            },
          },
        });
        if (error) throw error;
        setMessage({
          type: "success",
          text: "¡Cuenta creada con éxito! Ya podés iniciar sesión.",
        });
        setMode("login");
      }
    } catch (err) {
      setMessage({ type: "error", text: translateError(err.message) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      {/* ── Panel de marca ── */}
      <div style={styles.brandPanel}>
        <div style={styles.brandContent}>
          <div style={styles.brandIcon}>
            <GraduationCap size={36} color="#fff" />
          </div>
          <h1 style={styles.brandTitle}>IA Institucional</h1>
          <p style={styles.brandSub}>
            Sistema RAG para consulta y gestión de documentos académicos.
          </p>
          <ul style={styles.featureList}>
            {[
              "Consultas en lenguaje natural",
              "Documentos indexados semánticamente",
              "Respuestas con fuentes citadas",
            ].map((f) => (
              <li key={f} style={styles.featureItem}>
                <span style={styles.featureDot} />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Panel de formulario ── */}
      <div style={styles.formPanel}>
        <div style={styles.card}>
          {/* Tabs login / registro */}
          <div style={styles.tabs}>
            <button
              style={{ ...styles.tab, ...(mode === "login" ? styles.tabActive : {}) }}
              onClick={() => { setMode("login"); setMessage(null); }}
              type="button"
            >
              <LogIn size={14} /> Iniciar sesión
            </button>
            <button
              style={{ ...styles.tab, ...(mode === "register" ? styles.tabActive : {}) }}
              onClick={() => { setMode("register"); setMessage(null); }}
              type="button"
            >
              <UserPlus size={14} /> Registrarse
            </button>
          </div>

          <form onSubmit={handleSubmit} style={styles.form}>
            {/* Campos solo en registro */}
            {mode === "register" && (
              <div style={styles.row}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Nombre</label>
                  <input
                    style={styles.input}
                    name="nombre"
                    type="text"
                    placeholder="Juan"
                    value={form.nombre}
                    onChange={handleChange}
                    required
                    disabled={loading}
                    autoComplete="given-name"
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Apellido</label>
                  <input
                    style={styles.input}
                    name="apellido"
                    type="text"
                    placeholder="Pérez"
                    value={form.apellido}
                    onChange={handleChange}
                    required
                    disabled={loading}
                    autoComplete="family-name"
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Correo electrónico</label>
              <input
                style={styles.input}
                name="email"
                type="email"
                placeholder="correo@institución.edu"
                value={form.email}
                onChange={handleChange}
                required
                disabled={loading}
                autoComplete="email"
              />
            </div>

            {/* Contraseña */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Contraseña</label>
              <div style={styles.passWrapper}>
                <input
                  style={{ ...styles.input, paddingRight: 40, flex: 1 }}
                  name="password"
                  type={showPass ? "text" : "password"}
                  placeholder={mode === "register" ? "Mínimo 6 caracteres" : "••••••••"}
                  value={form.password}
                  onChange={handleChange}
                  required
                  disabled={loading}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={6}
                />
                <button
                  type="button"
                  style={styles.eyeBtn}
                  onClick={() => setShowPass((v) => !v)}
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Mensaje de resultado */}
            {message && (
              <div
                style={{
                  ...styles.alert,
                  background: message.type === "success" ? "var(--success-bg)" : "var(--danger-bg)",
                  color: message.type === "success" ? "var(--success)" : "var(--danger)",
                  border: `1px solid ${message.type === "success" ? "var(--success)" : "var(--danger)"}`,
                }}
              >
                {message.text}
              </div>
            )}

            {/* Botón */}
            <button
              type="submit"
              style={{ ...styles.submitBtn, ...(loading ? styles.submitDisabled : {}) }}
              disabled={loading}
            >
              {loading ? (
                <><span style={styles.spinner} /> Procesando...</>
              ) : mode === "login" ? (
                <><LogIn size={15} /> Iniciar sesión</>
              ) : (
                <><UserPlus size={15} /> Crear cuenta</>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ── Traducción de errores comunes de Supabase ── */
function translateError(msg = "") {
  if (msg.includes("Invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (msg.includes("Email not confirmed")) return "Confirmá tu correo antes de iniciar sesión.";
  if (msg.includes("User already registered")) return "Ya existe una cuenta con ese correo.";
  if (msg.includes("Password should be at least")) return "La contraseña debe tener al menos 6 caracteres.";
  return msg;
}

/* ══════════════════════════ ESTILOS ══════════════════════════════════════ */
const styles = {
  page: {
    display: "flex",
    minHeight: "100svh",
    width: "100%",
  },

  /* ── Brand panel (izquierda) ── */
  brandPanel: {
    width: "42%",
    background: "linear-gradient(135deg, #5b21b6 0%, #7c3aed 60%, #a78bfa 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 40px",
    flexShrink: 0,
  },
  brandContent: {
    maxWidth: 340,
    color: "#fff",
  },
  brandIcon: {
    width: 64, height: 64,
    borderRadius: 16,
    background: "rgba(255,255,255,.18)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: 700,
    color: "#fff",
    marginBottom: 10,
    lineHeight: 1.2,
  },
  brandSub: {
    fontSize: 14,
    color: "rgba(255,255,255,.8)",
    lineHeight: 1.6,
    marginBottom: 28,
  },
  featureList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  featureItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "rgba(255,255,255,.9)",
  },
  featureDot: {
    width: 6, height: 6,
    borderRadius: "50%",
    background: "rgba(255,255,255,.7)",
    flexShrink: 0,
  },

  /* ── Form panel (derecha) ── */
  formPanel: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 24px",
    background: "var(--bg)",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "var(--bg-card)",
    borderRadius: 16,
    border: "1px solid var(--border)",
    padding: "32px 32px 28px",
    boxShadow: "var(--shadow)",
  },

  /* Tabs */
  tabs: {
    display: "flex",
    borderRadius: 8,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    padding: 3,
    marginBottom: 24,
    gap: 2,
  },
  tab: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "8px 12px",
    borderRadius: 6,
    background: "transparent",
    color: "var(--text)",
    fontSize: 13,
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
    transition: "all .15s",
  },
  tabActive: {
    background: "var(--bg-card)",
    color: "var(--accent)",
    boxShadow: "0 1px 3px rgba(0,0,0,.1)",
  },

  /* Formulario */
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text-h)",
    fontSize: 13,
    transition: "border-color .15s",
    boxSizing: "border-box",
  },
  passWrapper: {
    display: "flex",
    alignItems: "center",
    position: "relative",
  },
  eyeBtn: {
    position: "absolute",
    right: 10,
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    padding: 0,
  },

  alert: {
    fontSize: 13,
    padding: "10px 14px",
    borderRadius: 8,
    fontWeight: 500,
    lineHeight: 1.4,
  },

  submitBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "11px",
    borderRadius: 8,
    background: "var(--accent)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
    marginTop: 4,
    transition: "background .15s",
  },
  submitDisabled: {
    background: "var(--text-muted)",
    cursor: "not-allowed",
  },
  spinner: {
    display: "inline-block",
    width: 14, height: 14,
    border: "2px solid rgba(255,255,255,.3)",
    borderTopColor: "#fff",
    borderRadius: "50%",
    animation: "spin .7s linear infinite",
  },
};
