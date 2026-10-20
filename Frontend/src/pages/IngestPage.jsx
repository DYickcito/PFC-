/**
 * IngestPage.jsx — Vista de carga e indexación de documentos.
 * Solo accesible para administradores (el Navbar ya oculta el tab para otros roles,
 * pero aquí también se verifica).
 *
 * Columna izquierda: formulario de carga (drag & drop + selector de carrera)
 * Columna derecha:   historial de documentos subidos con búsqueda y filtros
 * Pie de página:     contadores de estado (indexados / en proceso / con error)
 *
 * En el historial, cada documento se puede editar (nombre, descripción y carrera),
 * reemplazar por una versión nueva (la anterior se elimina cuando la nueva termina
 * de indexarse), descargar o eliminar.
 *
 * Se pueden seleccionar varios archivos a la vez. Cada uno se sube por separado
 * y el backend los indexa de a uno, en segundo plano; aquí se consulta el estado
 * de cada documento cada pocos segundos y se muestra en la cola de indexación.
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
  RefreshCw,
  Trash2,
  Pencil,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { uploadDocument, replaceDocument, deleteDocument, downloadDocument, updateDocument, getIngestStatus, getIngestJobs } from "../services/api";

const POLL_MS = 4000;

/* ── Extensiones aceptadas ── */
const ACCEPTED_EXTS = [".pdf", ".docx", ".txt", ".xlsx", ".csv"];
const ACCEPTED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
];

const MAX_MB = 50;

/* ── Estados de indexación que devuelve el backend ── */
const JOB_LABEL = {
  en_cola: { label: "En cola", color: "var(--text-muted)", bg: "var(--bg)" },
  procesando: { label: "Indexando...", color: "var(--warning)", bg: "var(--warning-bg)" },
  indexado: { label: "Indexado", color: "var(--success)", bg: "var(--success-bg)" },
  error: { label: "Error", color: "var(--danger)", bg: "var(--danger-bg)" },
};
const EN_CURSO = ["en_cola", "procesando"];

function JobBadge({ estado }) {
  const { label, color, bg } = JOB_LABEL[estado] ?? JOB_LABEL.en_cola;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color, background: bg, border: "1px solid var(--border)", borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap" }}>
      {estado === "procesando" ? <Clock size={11} /> : estado === "error" ? <AlertCircle size={11} /> : estado === "indexado" ? <CheckCircle size={11} /> : null}
      {label}
    </span>
  );
}

function sinExtension(nombreArchivo) {
  return nombreArchivo.replace(/\.[^.]+$/, "");
}

/* ── Color de cada tipo de mensaje (variables de index.css) ── */
const ALERT_COLOR = { success: "success", info: "warning", error: "danger" };

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
  const [files, setFiles] = useState([]);
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

  /* ── Estado de indexaciones en segundo plano ── */
  const [jobs, setJobs] = useState([]); // [{ id, nombre, estado, nodes, duracion, error, reemplaza, aviso }]

  /* ── Gestión de documentos del historial ── */
  const [confirmDelete, setConfirmDelete] = useState(null); // id del documento a confirmar
  const [busyDoc, setBusyDoc] = useState(null); // id del documento con una acción en curso
  const replaceInputRef = useRef();
  const replaceTarget = useRef(null);
  const [editing, setEditing] = useState(null); // { id, nombre, descripcion, id_carrera }
  const [jobsSummary, setJobsSummary] = useState({ en_cola: 0, procesando: 0, errores: 0 });

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
        id, nombre_documento, descripcion, ruta_archivo, fecha_carga, id_carrera,
        estado ( nombre_estado ),
        carrera ( nombre_carrera ),
        tipo_documento ( nombre_tipo )
      `)
      .order("fecha_carga", { ascending: false });
    setDocumentos(data ?? []);
    setLoadingDocs(false);
  }, []);

  useEffect(() => { fetchDocumentos(); }, [fetchDocumentos]);

  /* ── Contadores de indexación (backend) ── */
  const fetchJobs = useCallback(async () => {
    try {
      const { data } = await getIngestJobs();
      setJobsSummary({ en_cola: data.en_cola ?? 0, procesando: data.procesando ?? 0, errores: data.errores ?? 0 });
    } catch {
      /* si falla, se mantienen los últimos valores */
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  /* ── Seguimiento de documentos en cola o indexándose ── */
  const hayEnCurso = jobs.some((j) => EN_CURSO.includes(j.estado));
  useEffect(() => {
    if (!hayEnCurso) return undefined;
    const timer = setInterval(async () => {
      const activos = jobs.filter((j) => EN_CURSO.includes(j.estado));
      let terminoAlguno = false;
      const updates = {};
      for (const job of activos) {
        try {
          const { data } = await getIngestStatus(job.id);
          if (data.estado !== job.estado) {
            updates[job.id] = { estado: data.estado, nodes: data.nodes_indexed, duracion: data.duracion_s, error: data.error, aviso: data.aviso };
            if (!EN_CURSO.includes(data.estado)) terminoAlguno = true;
          }
        } catch {
          /* se reintenta en el siguiente ciclo */
        }
      }
      if (Object.keys(updates).length > 0) {
        setJobs((prev) => prev.map((j) => (updates[j.id] ? { ...j, ...updates[j.id] } : j)));
      }
      if (terminoAlguno) {
        fetchDocumentos();
      }
      fetchJobs();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobs, hayEnCurso, fetchDocumentos, fetchJobs]);

  /* ── Manejo de archivos (uno o varios) ── */
  function handleFilesSelect(fileList) {
    const nuevos = Array.from(fileList ?? []);
    if (nuevos.length === 0) return;
    const rechazados = [];
    const aceptados = [];
    for (const f of nuevos) {
      if (!ACCEPTED_MIME.includes(f.type)) rechazados.push(`${f.name} (tipo no permitido)`);
      else if (f.size > MAX_MB * 1024 * 1024) rechazados.push(`${f.name} (supera ${MAX_MB} MB)`);
      else aceptados.push(f);
    }
    setFiles((prev) => {
      const yaEsta = (f) => prev.some((p) => p.name === f.name && p.size === f.size);
      const lista = [...prev, ...aceptados.filter((f) => !yaEsta(f))];
      if (lista.length === 1 && !nombre) setNombre(sinExtension(lista[0].name));
      return lista;
    });
    setUploadMsg(
      rechazados.length > 0
        ? { type: "error", text: `No se agregaron: ${rechazados.join(", ")}. Usa: ${ACCEPTED_EXTS.join(", ")}.` }
        : null
    );
  }

  function removeFile(index) {
    setFiles((prev) => {
      const lista = prev.filter((_, i) => i !== index);
      if (lista.length !== 1) setNombre("");
      return lista;
    });
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFilesSelect(e.dataTransfer.files);
  }

  /* ── Submit: sube cada archivo por separado ── */
  async function handleUpload(e) {
    e.preventDefault();
    if (files.length === 0) { setUploadMsg({ type: "error", text: "Selecciona al menos un archivo." }); return; }
    if (!selectedCarrera) { setUploadMsg({ type: "error", text: "Selecciona una carrera." }); return; }
    if (files.length === 1 && !nombre.trim()) { setUploadMsg({ type: "error", text: "Ingresa un nombre para el documento." }); return; }

    setUploading(true);
    setUploadMsg(null);

    const recibidos = [];
    const fallidos = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("nombre_documento", files.length === 1 ? nombre.trim() : sinExtension(f.name));
      fd.append("descripcion", descripcion.trim());
      fd.append("id_carrera", selectedCarrera);
      try {
        const res = await uploadDocument(fd);
        recibidos.push({ id: res.data.document_id, nombre: res.data.nombre_documento, estado: res.data.estado ?? "en_cola" });
      } catch (err) {
        fallidos.push(`${f.name}: ${err.response?.data?.detail ?? err.message}`);
      }
    }

    if (recibidos.length > 0) setJobs((prev) => [...recibidos, ...prev]);
    setFiles((prev) => prev.filter((f) => fallidos.some((m) => m.startsWith(`${f.name}:`))));
    if (fallidos.length === 0) { setNombre(""); setDescripcion(""); }

    const partes = [];
    if (recibidos.length > 0) {
      partes.push(
        recibidos.length === 1
          ? `"${recibidos[0].nombre}" recibido. Se indexa en segundo plano; puedes seguir usando el sistema.`
          : `${recibidos.length} documentos recibidos. Se indexan uno por uno en segundo plano; puedes seguir usando el sistema.`
      );
    }
    if (fallidos.length > 0) partes.push(`No se pudieron subir: ${fallidos.join("; ")}`);
    setUploadMsg({ type: fallidos.length > 0 ? "error" : "info", text: partes.join(" ") });

    setUploading(false);
    fetchDocumentos();
    fetchJobs();
  }

  /* ── Reemplazar un documento por una versión nueva ── */
  function startReplace(doc) {
    replaceTarget.current = doc;
    setConfirmDelete(null);
    replaceInputRef.current?.click();
  }

  async function onReplaceFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    const doc = replaceTarget.current;
    if (!f || !doc) return;
    if (!ACCEPTED_MIME.includes(f.type)) {
      setUploadMsg({ type: "error", text: `Tipo no permitido. Usa: ${ACCEPTED_EXTS.join(", ")}` });
      return;
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      setUploadMsg({ type: "error", text: `El archivo supera los ${MAX_MB} MB.` });
      return;
    }
    const fd = new FormData();
    fd.append("file", f);
    setBusyDoc(doc.id);
    try {
      const res = await replaceDocument(doc.id, fd);
      setJobs((prev) => [{ id: res.data.document_id, nombre: res.data.nombre_documento, estado: res.data.estado ?? "en_cola", reemplaza: doc.id }, ...prev]);
      setUploadMsg({
        type: "info",
        text: `Nueva versión de "${doc.nombre_documento}" recibida. La anterior sigue respondiendo consultas hasta que la nueva termine de indexarse.`,
      });
      fetchJobs();
    } catch (err) {
      setUploadMsg({ type: "error", text: `No se pudo reemplazar "${doc.nombre_documento}": ${err.response?.data?.detail ?? err.message}` });
    } finally {
      setBusyDoc(null);
    }
  }

  /* ── Editar nombre, descripción y carrera ── */
  function startEdit(doc) {
    setConfirmDelete(null);
    setEditing({
      id: doc.id,
      nombre: doc.nombre_documento ?? "",
      descripcion: doc.descripcion ?? "",
      id_carrera: String(doc.id_carrera ?? ""),
    });
  }

  async function saveEdit(doc) {
    const nombreNuevo = editing.nombre.trim();
    if (!nombreNuevo) { setUploadMsg({ type: "error", text: "El nombre del documento no puede quedar vacío." }); return; }
    const cambios = {};
    if (nombreNuevo !== doc.nombre_documento) cambios.nombre_documento = nombreNuevo;
    if (editing.descripcion.trim() !== (doc.descripcion ?? "")) cambios.descripcion = editing.descripcion.trim();
    if (editing.id_carrera && editing.id_carrera !== String(doc.id_carrera ?? "")) cambios.id_carrera = Number(editing.id_carrera);
    if (Object.keys(cambios).length === 0) { setEditing(null); return; }

    setBusyDoc(doc.id);
    try {
      const res = await updateDocument(doc.id, cambios);
      setEditing(null);
      setUploadMsg(
        res.data.aviso
          ? { type: "info", text: res.data.aviso }
          : { type: "success", text: `"${nombreNuevo}" actualizado.` }
      );
      fetchDocumentos();
    } catch (err) {
      setUploadMsg({ type: "error", text: `No se pudo actualizar "${doc.nombre_documento}": ${err.response?.data?.detail ?? err.message}` });
    } finally {
      setBusyDoc(null);
    }
  }

  /* ── Eliminar un documento ── */
  async function handleDelete(doc) {
    setBusyDoc(doc.id);
    try {
      await deleteDocument(doc.id);
      setConfirmDelete(null);
      setUploadMsg({ type: "success", text: `"${doc.nombre_documento}" fue eliminado y ya no se usa en las respuestas.` });
      fetchDocumentos();
    } catch (err) {
      setUploadMsg({ type: "error", text: `No se pudo eliminar "${doc.nombre_documento}": ${err.response?.data?.detail ?? err.message}` });
    } finally {
      setBusyDoc(null);
    }
  }

  /* ── Filtrado del historial ── */
  const filtered = documentos.filter((d) => {
    const matchSearch =
      d.nombre_documento?.toLowerCase().includes(search.toLowerCase()) ||
      d.tipo_documento?.nombre_tipo?.toLowerCase().includes(search.toLowerCase());
    const matchCarrera =
      filterCarrera === "all" || String(d.id_carrera ?? "") === filterCarrera;
    return matchSearch && matchCarrera;
  });

  /* ── Contadores ── */
  const totalIndexed = documentos.filter((d) => d.estado?.nombre_estado === "subido").length;

  /* ── Descarga del archivo original ── */
  async function handleDownload(doc) {
    setBusyDoc(doc.id);
    try {
      const res = await downloadDocument(doc.id);
      const ext = (doc.ruta_archivo ?? "").match(/\.[^.\\/]+$/)?.[0] ?? "";
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      const nombre = doc.nombre_documento ?? "documento";
      a.download = nombre.toLowerCase().endsWith(ext.toLowerCase()) ? nombre : `${nombre}${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      // Con responseType "blob", el detalle del error también llega como blob
      let detail = err.message;
      try { detail = JSON.parse(await err.response.data.text()).detail ?? detail; } catch { /* sin detalle */ }
      setUploadMsg({ type: "error", text: `No se pudo descargar "${doc.nombre_documento}": ${detail}` });
    } finally {
      setBusyDoc(null);
    }
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

          {/* Nombre del documento (solo con un archivo; con varios se usa el nombre de cada uno) */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Nombre del documento</label>
            {files.length > 1 ? (
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Con varios archivos se usa el nombre de cada archivo como nombre del documento.
              </p>
            ) : (
              <input
                style={styles.input}
                type="text"
                placeholder="Ej: Reglamento Académico 2025"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                disabled={uploading}
              />
            )}
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
            style={{ ...styles.dropzone, ...(dragOver ? styles.dropzoneActive : {}), ...(files.length > 0 ? styles.dropzoneFilled : {}) }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_MIME.join(",")}
              style={{ display: "none" }}
              onChange={(e) => { handleFilesSelect(e.target.files); e.target.value = ""; }}
            />

            {files.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                {files.map((f, i) => (
                  <div key={`${f.name}-${f.size}`} style={styles.filePreview}>
                    <FileText size={22} color="var(--accent)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, color: "var(--text-h)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</p>
                      <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {extLabel(f.name)} · {(f.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <button
                      type="button"
                      style={styles.removeFile}
                      title="Quitar archivo"
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      disabled={uploading}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <p style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                  {files.length} archivo{files.length > 1 ? "s" : ""} · haz clic o arrastra más para agregarlos
                </p>
              </div>
            ) : (
              <>
                <div style={styles.dropIcon}>
                  <FileUp size={28} color="var(--accent)" />
                </div>
                <p style={{ fontWeight: 600, color: "var(--text-h)", margin: "8px 0 4px", fontSize: 14 }}>
                  Arrastra y suelta uno o varios documentos
                </p>
                <p style={{ fontSize: 13, color: "var(--text)" }}>
                  o{" "}
                  <span style={{ color: "var(--accent)", cursor: "pointer", textDecoration: "underline" }}>
                    haz clic para seleccionar
                  </span>
                </p>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  {ACCEPTED_EXTS.join("  ·  ")} · Máx. {MAX_MB} MB por archivo
                </p>
              </>
            )}
          </div>

          {/* Mensaje de resultado */}
          {uploadMsg && (
            <div style={{
              ...styles.alert,
              background: `var(--${ALERT_COLOR[uploadMsg.type]}-bg)`,
              color: `var(--${ALERT_COLOR[uploadMsg.type]})`,
              border: `1px solid var(--${ALERT_COLOR[uploadMsg.type]})`,
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
                <span style={styles.spinner} /> Subiendo...
              </>
            ) : (
              <>
                <Upload size={15} /> {files.length > 1 ? `Cargar ${files.length} documentos` : "Cargar documento"}
              </>
            )}
          </button>
        </form>

        {/* ── Cola de indexación de esta sesión ── */}
        {jobs.length > 0 && (
          <div style={styles.queue}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-h)", marginBottom: 6 }}>Cola de indexación</p>
            {jobs.map((j) => (
              <div key={j.id} style={styles.queueRow}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "var(--text-h)" }} title={j.nombre}>
                  {j.nombre}
                </span>
                <span style={{ fontSize: 11, color: j.estado === "error" || j.aviso ? "var(--danger)" : "var(--text-muted)", whiteSpace: "nowrap" }} title={j.aviso ?? j.error ?? ""}>
                  {j.reemplaza && j.estado !== "error" && "Reemplazo · "}
                  {j.estado === "indexado" && `${j.nodes} fragmentos · ${j.duracion} s`}
                  {j.estado === "error" && (j.error ?? "").slice(0, 60)}
                  {j.aviso && " · revisar versión anterior"}
                </span>
                <JobBadge estado={j.estado} />
              </div>
            ))}
          </div>
        )}

        {/* ── Contadores ── */}
        <div style={styles.counters}>
          <div style={{ ...styles.counterCard, borderColor: "var(--success)", background: "var(--success-bg)" }}>
            <span style={{ ...styles.counterNum, color: "var(--success)" }}>{totalIndexed}</span>
            <span style={{ fontSize: 12, color: "var(--success)" }}>Documentos indexados</span>
          </div>
          <div style={{ ...styles.counterCard, borderColor: "var(--warning)", background: "var(--warning-bg)" }}>
            <span style={{ ...styles.counterNum, color: "var(--warning)" }}>{jobsSummary.procesando + jobsSummary.en_cola}</span>
            <span style={{ fontSize: 12, color: "var(--warning)" }}>En proceso</span>
          </div>
          <div style={{ ...styles.counterCard, borderColor: "var(--danger)", background: "var(--danger-bg)" }}>
            <span style={{ ...styles.counterNum, color: "var(--danger)" }}>{jobsSummary.errores}</span>
            <span style={{ fontSize: 12, color: "var(--danger)" }}>Con errores</span>
          </div>
        </div>
      </div>

      {/* Selector de archivo para reemplazar un documento del historial */}
      <input
        ref={replaceInputRef}
        type="file"
        accept={ACCEPTED_MIME.join(",")}
        style={{ display: "none" }}
        onChange={onReplaceFile}
      />

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
                  {editing?.id === doc.id ? (
                    <div style={styles.editBox}>
                      <label style={styles.editLabel}>Nombre</label>
                      <input
                        style={styles.editInput}
                        value={editing.nombre}
                        onChange={(e) => setEditing({ ...editing, nombre: e.target.value })}
                        disabled={busyDoc === doc.id}
                      />
                      <label style={styles.editLabel}>Carrera</label>
                      <select
                        style={styles.editInput}
                        value={editing.id_carrera}
                        onChange={(e) => setEditing({ ...editing, id_carrera: e.target.value })}
                        disabled={busyDoc === doc.id}
                      >
                        {!editing.id_carrera && <option value="">Sin asignar</option>}
                        {carreras.map((c) => (
                          <option key={c.id} value={String(c.id)}>{c.nombre_carrera}</option>
                        ))}
                      </select>
                      <label style={styles.editLabel}>Descripción</label>
                      <input
                        style={styles.editInput}
                        value={editing.descripcion}
                        placeholder="Breve descripción del contenido"
                        onChange={(e) => setEditing({ ...editing, descripcion: e.target.value })}
                        disabled={busyDoc === doc.id}
                      />
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button type="button" style={styles.confirmSave} disabled={busyDoc === doc.id} onClick={() => saveEdit(doc)}>
                          {busyDoc === doc.id ? "Guardando..." : "Guardar"}
                        </button>
                        <button type="button" style={styles.confirmCancel} disabled={busyDoc === doc.id} onClick={() => setEditing(null)}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                  <>
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
                    {EN_CURSO.includes(jobs.find((j) => j.id === doc.id)?.estado)
                      ? <JobBadge estado={jobs.find((j) => j.id === doc.id).estado} />
                      : <StatusBadge estadoNombre={doc.estado?.nombre_estado ?? "subido"} />}
                    {jobs.some((j) => j.reemplaza === doc.id && EN_CURSO.includes(j.estado)) && (
                      <span style={{ ...styles.extTag, color: "var(--warning)", background: "var(--warning-bg)" }}>Reemplazándose</span>
                    )}
                  </div>
                  <p style={styles.docDate}>{formatDate(doc.fecha_carga)}</p>
                  </>
                  )}
                  {confirmDelete === doc.id && (
                    <div style={styles.confirmBox}>
                      <span>¿Eliminar este documento? Dejará de usarse en las respuestas.</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" style={styles.confirmDanger} disabled={busyDoc === doc.id} onClick={() => handleDelete(doc)}>
                          {busyDoc === doc.id ? "Eliminando..." : "Eliminar"}
                        </button>
                        <button type="button" style={styles.confirmCancel} disabled={busyDoc === doc.id} onClick={() => setConfirmDelete(null)}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div style={styles.docActions}>
                  <button
                    style={{ ...styles.downloadBtn, ...(editing?.id === doc.id ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}) }}
                    title="Editar nombre, carrera y descripción"
                    disabled={busyDoc === doc.id}
                    onClick={() => (editing?.id === doc.id ? setEditing(null) : startEdit(doc))}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    style={styles.downloadBtn}
                    title="Reemplazar por una versión nueva"
                    disabled={busyDoc === doc.id}
                    onClick={() => startReplace(doc)}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    style={{ ...styles.downloadBtn, color: "var(--danger)" }}
                    title="Eliminar documento"
                    disabled={busyDoc === doc.id}
                    onClick={() => setConfirmDelete(confirmDelete === doc.id ? null : doc.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    style={styles.downloadBtn}
                    title="Descargar el archivo original"
                    disabled={busyDoc === doc.id}
                    onClick={() => handleDownload(doc)}
                  >
                    <Download size={13} />
                  </button>
                </div>
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

  queue: {
    marginTop: 18,
    padding: "12px 14px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    maxWidth: 560,
  },
  queueRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 0",
    borderTop: "1px solid var(--border)",
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
  docActions: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flexShrink: 0,
  },
  confirmBox: {
    marginTop: 8,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--danger)",
    background: "var(--danger-bg)",
    color: "var(--danger)",
    fontSize: 11,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  confirmDanger: {
    padding: "4px 10px",
    borderRadius: 5,
    border: "none",
    background: "var(--danger)",
    color: "#fff",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  editBox: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  editLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.3px",
  },
  editInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "5px 8px",
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text-h)",
    fontSize: 12,
    marginBottom: 2,
  },
  confirmSave: {
    padding: "4px 10px",
    borderRadius: 5,
    border: "none",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  confirmCancel: {
    padding: "4px 10px",
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    color: "var(--text)",
    fontSize: 11,
    cursor: "pointer",
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
