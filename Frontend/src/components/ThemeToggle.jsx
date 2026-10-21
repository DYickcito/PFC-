/**
 * ThemeToggle.jsx — Selector de tema: claro, oscuro o el del sistema.
 * Con `conTexto` muestra también el nombre de cada opción (ventana de configuración).
 */
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "../lib/theme";

const OPCIONES = [
  { id: "light", label: "Claro", Icon: Sun },
  { id: "dark", label: "Oscuro", Icon: Moon },
  { id: "system", label: "Sistema", Icon: Monitor },
];

export default function ThemeToggle({ conTexto = false }) {
  const [tema, setTema] = useTheme();

  return (
    <div style={styles.group} role="radiogroup" aria-label="Tema de la interfaz">
      {OPCIONES.map(({ id, label, Icon }) => {
        const activo = tema === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={activo}
            title={`Tema: ${label}`}
            onClick={() => setTema(id)}
            style={{
              ...styles.btn,
              ...(conTexto ? styles.btnTexto : {}),
              ...(activo ? styles.btnActive : {}),
            }}
          >
            <Icon size={14} />
            {conTexto && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

const styles = {
  group: {
    display: "inline-flex",
    gap: 2,
    padding: 2,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
  },
  btn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: 28,
    height: 26,
    borderRadius: 6,
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    transition: "background-color .15s, color .15s",
  },
  btnTexto: {
    width: "auto",
    padding: "0 10px",
    fontSize: 12,
    fontWeight: 500,
  },
  btnActive: {
    background: "var(--bg-card)",
    color: "var(--accent)",
    boxShadow: "var(--shadow-sm)",
  },
};
