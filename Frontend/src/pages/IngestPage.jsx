/**
 * IngestPage.jsx — Vista de carga e indexación de documentos.
 * Solo accesible para administradores (el Navbar ya oculta el tab para otros roles,
 * pero aquí también se verifica).
 *
 * Columna izquierda: formulario de carga (drag & drop + selector de carrera)
 * Columna derecha:   historial de documentos subidos con búsqueda y filtros
 * Pie de página:     contadores de estado (indexados / en proceso / con error)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Upload,
  FileText,
  Search,
  Download,
  CheckCircle,
  Clock,
  AlertCircle,
  FileUp,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { uploadDocument } from "../services/api";

/* ── Extensiones aceptadas ── */
const ACCEPTED_EXTS = [".pdf", ".docx", ".txt", ".xlsx", ".csv"];
const ACCEPTED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
];

/* ── Utilidades ── */
function extLabel(filename = "") {
  return filename.split(".").pop()?.toUpperCase() ?? "—";
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

function StatusBadge({ estadoNombre }) {
  const map = {
    subido: { color: "var(--success)", bg: "var(--success-bg)", icon: <CheckCircle size={11} />, label: "Indexado" },
    activo: { color: "var(--accent)", bg: "var(--accent-light)", icon: <Clock size={11} />, label: "Activo" },
    inactivo: { color: "var(--danger)", bg: "var(--danger-bg)", icon: <AlertCircle size={11} />, label: "Inactivo" },
  };
  const { color, bg, icon, label } = map[estadoNombre] ?? map.subido;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color, background: bg, borderRadius: 4, padding: "2px 7px" }}>
      {icon} {label}
    </span>
  );
}

export default function IngestPage() {
  /* ── Estado del formulario ── */
  const [carreras, setCarreras] = useState([]);
  const [selectedCarrera, setSelectedCarrera] = useState("");
  const [file, setFile] = useState(null);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null); // { type: 'success'|'error', text }
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef();

  /* ── Estado del historial ── */
  const [documentos, setDocumentos] = useState([]);
  const [search, setSearch] = useState("");
  const [filterCarrera, setFilterCarrera] = useState("all");
  const [loadingDocs, setLoadingDocs] = useState(false);

  /* ── Cargar carreras desde Supabase ── */
  useEffect(() => {
    supabase
      .from("carrera")
      .select("id, nombre_carrera")
      .then(({ data }) => {
        if (data) {
          setCarreras(data);
          if (data.length > 0) setSelectedCarrera(String(data[0].id));
        }
      });
  }, []);

  /* ── Cargar documentos del historial ── */
  const fetchDocumentos = useCallback(async () => {
    setLoadingDocs(true);
    const { data } = await supabase
      .from("documento")
      .select(`
        id, nombre_documento, descripcion, ruta_archivo, fecha_carga,
        estado ( nombre_estado ),
        carrera ( nombre_carrera ),
        tipo_documento ( nombre_tipo )
      `)
      .order("fecha_carga", { ascending: false });
    setDocumentos(data ?? []);
    setLoadingDocs(false);
  }, []);

  useEffect(() => { fetchDocumentos(); }, [fetchDocumentos]);

  /* ── Manejo de archivo ── */
  function handleFileSelect(f) {
    if (!f) return;
    if (!ACCEPTED_MIME.includes(f.type)) {
      setUploadMsg({ type: "error", text: `Tipo no permitido. Usa: ${ACCEPTED_EXTS.join(", ")}` });
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setUploadMsg({ type: "error", text: "El archivo supera los 50 MB." });
      return;
    }
    setFile(f);
    setUploadMsg(null);
    if (!nombre) setNombre(f.name.replace(/\.[^.]+$/, ""));
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files[0]);
  }

  /* ── Submit del formulario ── */
  async function handleUpload(e) {
    e.preventDefault();
    if (!file) { setUploadMsg({ type: "error", text: "Seleccioná un archivo primero." }); return; }
    if (!selectedCarrera) { setUploadMsg({ type: "error", text: "Seleccioná una carrera." }); return; }
    if (!nombre.trim()) { setUploadMsg({ type: "error", text: "Ingresá un nombre para el documento." }); return; }

    setUploading(true);
    setUploadMsg(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("nombre_documento", nombre.trim());
    fd.append("descripcion", descripcion.trim());
    fd.append("id_carrera", selectedCarrera);

    try {
      const res = await uploadDocument(fd);
      setUploadMsg({
        type: "success",
        text: `✅ "${res.data.nombre_documento}" indexado — ${res.data.nodes_indexed} chunks.`,
      });
      setFile(null);
      setNombre("");
      setDescripcion("");
      fetchDocumentos();
    } catch (err) {
      const detail = err.response?.data?.detail ?? err.message;
      setUploadMsg({ type: "error", text: `Error: ${detail}` });
    } finally {
      setUploading(false);
    }
  }

  /* ── Filtrado del historial ── */
  const filtered = documentos.filter((d) => {
    const matchSearch =
      d.nombre_documento?.toLowerCase().includes(search.toLowerCase()) ||
      d.tipo_documento?.nombre_tipo?.toLowerCase().includes(search.toLowerCase());
    const matchCarrera =
      filterCarrera === "all" || String(d.carrera?.id ?? "") === filterCarrera;
    return matchSearch && matchCarrera;
  });

  /* ── Contadores ── */
  const totalIndexed = documentos.filter((d) => d.estado?.nombre_estado === "subido").length;

  /* ── Descarga de documento ── */
  function handleDownload(doc) {
    // Si la ruta es local, no podemos descargar directamente desde el browser.
    // Informamos al usuario. (En producción, esto sería un endpoint de descarga.)
    alert(`Ruta del archivo:\n${doc.ruta_archivo}\n\nEn producción este botón llama a un endpoint de descarga segura.`);
  }

  /* ── Render ── */
  return (
    <div style={styles.page}>
      {/* ══ Columna izquierda — Formulario ══ */}
      <div style={styles.left}>
        {/* Breadcrumb */}
        <p style={styles.breadcrumb}>
          <span style={styles.breadHome}>Módulo</span>
          {" / "}
          <span style={styles.breadCurrent}>Ingesta de datos</span>
        </p>

        <h1 style={styles.title}>Carga de Documentos</h1>
        <p style={styles.subtitle}>
          Asocia y procesa <em>archivos académicos</em> para indexarlos en el sistema.
        </p>

        <form onSubmit={handleUpload} style={styles.form}>
          {/* Selector de carrera */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Programa / Carrera</label>
            <select
              style={styles.select}
              value={selectedCarrera}
              onChange={(e) => setSelectedCarrera(e.target.value)}
              disabled={uploading}
            >
              {carreras.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.nombre_carrera}
                </option>
              ))}
            </select>
          </div>

          {/* Nombre del documento */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Nombre del documento</label>
            <input
              style={styles.input}
              type="text"
              placeholder="Ej: Reglamento Académico 2025"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={uploading}
            />
          </div>

          {/* Descripción opcional */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Descripción <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(opcional)</span></label>
            <input
              style={styles.input}
              type="text"
              placeholder="Breve descripción del contenido"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              disabled={uploading}
            />
          </div>

          {/* Dropzone */}
          <div
            style={{ ...styles.dropzone, ...(dragOver ? styles.dropzoneActive : {}), ...(file ? styles.dropzoneFilled : {}) }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !file && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_MIME.join(",")}
              style={{ display: "none" }}
              onChange={(e) => handleFileSelect(e.target.files[0])}
            />

            {file ? (
              <div style={styles.filePreview}>
                <FileText size={28} color="var(--accent)" />
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600, color: "var(--text-h)", fontSize: 13 }}>{file.name}</p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {extLabel(file.name)} · {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  type="button"
                  style={styles.removeFile}
                  onClick={(e) => { e.stopPropagation(); setFile(null); setNombre(""); }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <div style={styles.dropIcon}>
                  <FileUp size={28} color="var(--accent)" />
                </div>
                <p style={{ fontWeight: 600, color: "var(--text-h)", margin: "8px 0 4px", fontSize: 14 }}>
                  Arrastrá y soltá tu documento
                </p>
                <p style={{ fontSize: 13, color: "var(--text)" }}>
                  o{" "}
                  <span style={{ color: "var(--accent)", cursor: "pointer", textDecoration: "underline" }}>
                    hacé clic para seleccionar
                  </span>
                </p>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  {ACCEPTED_EXTS.join("  ·  ")} · Máx. 50 MB
                </p>
              </>
            )}
          </div>

          {/* Mensaje de resultado */}
          {uploadMsg && (
            <div style={{
              ...styles.alert,
              background: uploadMsg.type === "success" ? "var(--success-bg)" : "var(--danger-bg)",
              color: uploadMsg.type === "success" ? "var(--success)" : "var(--danger)",
              border: `1px solid ${uploadMsg.type === "success" ? "var(--success)" : "var(--danger)"}`,
            }}>
              {uploadMsg.text}
            </div>
          )}

          {/* Botón de envío */}
          <button
            type="submit"
            style={{ ...styles.submitBtn, ...(uploading ? styles.submitBtnDisabled : {}) }}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <span style={styles.spinner} /> Indexando...
              </>
            ) : (
              <>
                <Upload size={15} /> Cargar documento
              </>
            )}
          </button>
        </form>

        {/* ── Contadores ── */}
        <div style={styles.counters}>
          <div style={{ ...styles.counterCard, borderColor: "var(--success)", background: "var(--success-bg)" }}>
            <span style={{ ...styles.counterNum, color: "var(--success)" }}>{totalIndexed}</span>
            <span style={{ fontSize: 12, color: "var(--success)" }}>Documentos indexados</span>
          </div>
          <div style={{ ...styles.counterCard, borderColor: "var(--warning)", background: "var(--warning-bg)" }}>
            <span style={{ ...styles.counterNum, color: "var(--warning)" }}>{uploading ? 1 : 0}</span>
            <span style={{ fontSize: 12, color: "var(--warning)" }}>En proceso</span>
          </div>
          <div style={{ ...styles.counterCard, borderColor: "var(--danger)", background: "var(--danger-bg)" }}>
            <span style={{ ...styles.counterNum, color: "var(--danger)" }}>0</span>
            <span style={{ fontSize: 12, color: "var(--danger)" }}>Con errores</span>
          </div>
        </div>
      </div>

      {/* ══ Columna derecha — Historial ══ */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-h)" }}>Historial de Archivos</h2>
          <span style={styles.docCount}>{documentos.length} docs</span>
        </div>

        {/* Buscador */}
        <div style={styles.searchWrapper}>
          <Search size={13} style={{ color: "var(--text-muted)", position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          <input
            style={styles.searchInput}
            type="text"
            placeholder="Buscar archivo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Filtros */}
        <div style={styles.filters}>
          <select
            style={styles.filterSelect}
            value={filterCarrera}
            onChange={(e) => setFilterCarrera(e.target.value)}
          >
            <option value="all">Todos</option>
            {carreras.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.nombre_carrera}</option>
            ))}
          </select>
        </div>

        {/* Lista de documentos */}
        <div style={styles.docList}>
          {loadingDocs ? (
            <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px 0", fontSize: 13 }}>
              Cargando...
            </p>
          ) : filtered.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px 0", fontSize: 13 }}>
              No hay documentos.
            </p>
          ) : (
            filtered.map((doc) => (
              <div key={doc.id} style={styles.docCard}>
                <div style={styles.docCardIcon}>
                  <FileText size={18} color="var(--accent)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={styles.docName} title={doc.nombre_documento}>
                    {doc.nombre_documento}
                  </p>
                  <p style={styles.docMeta}>
                    {doc.carrera?.nombre_carrera ?? "—"}
                  </p>
                  <div style={styles.docTags}>
                    <span style={styles.extTag}>
                      {doc.tipo_documento?.nombre_tipo?.toUpperCase() ?? extLabel(doc.ruta_archivo)}
                    </span>
                    <StatusBadge estadoNombre={doc.estado?.nombre_estado ?? "subido"} />
                  </div>
                  <p style={styles.docDate}>{formatDate(doc.fecha_carga)}</p>
                </div>
                <button
                  style={styles.downloadBtn}
                  title="Descargar documento"
                  onClick={() => handleDownload(doc)}
                >
                  <Download size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

/* ═══════════════════════════════ ESTILOS ═══════════════════════════════════ */
const styles = {
  page: {
    display: "flex",
    flex: 1,
    gap: 0,
    minHeight: 0,
    overflow: "hidden",
  },

  /* ─ Izquierda ─ */
  left: {
    flex: 1,
    padding: "28px 32px 28px 32px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  breadcrumb: { fontSize: 12, color: "var(--text-muted)", marginBottom: 6 },
  breadHome: { color: "var(--text-muted)" },
  breadCurrent: { color: "var(--accent)", fontWeight: 600 },
  title: { fontSize: 26, fontWeight: 700, color: "var(--text-h)", margin: "0 0 6px" },
  subtitle: { fontSize: 13, color: "var(--text)", marginBottom: 24 },

  form: { display: "flex", flexDirection: "column", gap: 16 },

  fieldGroup: { display: "flex", flexDirection: "column", gap: 5 },
  label: { fontSize: 11, fontWeight: 600, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.5px" },
  select: {
    width: "100%", maxWidth: 280,
    padding: "9px 12px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    color: "var(--text-h)",
    fontSize: 13,
    cursor: "pointer",
  },
  input: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    color: "var(--text-h)",
    fontSize: 13,
  },

  dropzone: {
    border: "2px dashed var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: "36px 24px",
    textAlign: "center",
    cursor: "pointer",
    transition: "all .2s",
    background: "var(--bg-card)",
    marginTop: 4,
  },
  dropzoneActive: {
    borderColor: "var(--accent)",
    background: "var(--accent-light)",
  },
  dropzoneFilled: {
    borderStyle: "solid",
    borderColor: "var(--accent)",
    cursor: "default",
    padding: "16px 20px",
  },
  dropIcon: {
    width: 52, height: 52,
    borderRadius: "50%",
    background: "var(--accent-light)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  filePreview: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    textAlign: "left",
  },
  removeFile: {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 26, height: 26,
    borderRadius: 5,
    background: "var(--danger-bg)",
    color: "var(--danger)",
    border: "none",
    cursor: "pointer",
    flexShrink: 0,
  },

  alert: {
    fontSize: 13,
    padding: "10px 14px",
    borderRadius: "var(--radius)",
    fontWeight: 500,
  },

  submitBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "11px 24px",
    borderRadius: "var(--radius)",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
    transition: "background .15s",
    alignSelf: "flex-start",
    marginTop: 4,
  },
  submitBtnDisabled: {
    background: "var(--text-muted)",
    cursor: "not-allowed",
  },

  spinner: {
    display: "inline-block",
    width: 13, height: 13,
    border: "2px solid rgba(255,255,255,.3)",
    borderTopColor: "#fff",
    borderRadius: "50%",
    animation: "spin .7s linear infinite",
  },

  counters: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 14,
    marginTop: 28,
  },
  counterCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    padding: "16px 18px",
    borderRadius: "var(--radius-lg)",
    border: "1px solid",
  },
  counterNum: {
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1,
    marginBottom: 4,
  },

  /* ─ Sidebar ─ */
  sidebar: {
    width: 310,
    flexShrink: 0,
    borderLeft: "1px solid var(--border)",
    background: "var(--bg-sidebar)",
    display: "flex",
    flexDirection: "column",
    overflowY: "hidden",
  },
  sidebarHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 16px 10px",
    borderBottom: "1px solid var(--border)",
  },
  docCount: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "var(--border)",
    padding: "2px 8px",
    borderRadius: 12,
  },
  searchWrapper: {
    position: "relative",
    padding: "10px 12px 6px",
  },
  searchInput: {
    width: "100%",
    padding: "7px 10px 7px 30px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text-h)",
    fontSize: 12,
  },
  filters: {
    padding: "0 12px 8px",
    display: "flex",
    gap: 6,
  },
  filterSelect: {
    flex: 1,
    padding: "6px 8px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 12,
    cursor: "pointer",
  },
  docList: {
    flex: 1,
    overflowY: "auto",
    padding: "6px 12px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  docCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    transition: "box-shadow .15s",
  },
  docCardIcon: {
    width: 32, height: 32,
    borderRadius: 7,
    background: "var(--accent-light)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  docName: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-h)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    marginBottom: 2,
  },
  docMeta: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginBottom: 5,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  docTags: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
    marginBottom: 4,
  },
  extTag: {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--text-muted)",
    background: "var(--border)",
    borderRadius: 4,
    padding: "2px 6px",
    letterSpacing: "0.3px",
  },
  docDate: {
    fontSize: 10,
    color: "var(--text-muted)",
  },
  downloadBtn: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
    marginTop: 2,
  },
};
