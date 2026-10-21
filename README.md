# Módulo RAG de consultas académicas

Asistente que responde preguntas sobre la carrera de Diseño y Desarrollo de Software de Tecsup (malla curricular, reglamentos, trámites, horarios, docentes y sílabos) a partir de los documentos oficiales que sube un administrador. Usa recuperación aumentada por generación (RAG): busca los fragmentos más parecidos a la pregunta y el modelo de lenguaje redacta la respuesta solo con esa información.

Proyecto de fin de carrera, Tecsup, 2026. Se desarrolla con Scrum.

## Cómo funciona

1. El administrador sube un documento (PDF, Word, Excel, CSV o TXT). El backend extrae el texto, lo limpia (encabezados, pies y números de página repetidos), lo divide en fragmentos y guarda sus vectores en Qdrant. Esto corre en segundo plano y en cola.
2. Cuando alguien pregunta, la pregunta se convierte en vector con Gemini y se buscan los 5 fragmentos más cercanos. Los saludos y las preguntas sobre el propio asistente ("hola", "qué datos tienes") se responden sin buscar, y una pregunta repetida en los últimos 10 minutos sale de una caché en memoria.
3. Si algún fragmento supera el umbral de similitud (0.58 por defecto), el modelo responde solo con esos fragmentos y la interfaz muestra las fuentes. Si ninguno lo supera, el asistente avisa que la pregunta no está en los documentos y responde con conocimiento general, sin inventar datos de la institución.
4. La respuesta llega en streaming: el texto aparece mientras el modelo escribe. Cada consulta se guarda en la tabla `consulta` de Supabase para el historial, junto con el tiempo que tardó.

## Tecnologías

| Parte | Herramienta |
|---|---|
| Frontend | React 19 y Vite 8 |
| Backend | FastAPI (Python 3.11 o 3.12) |
| Orquestación RAG | LlamaIndex |
| Embeddings | Google Gemini, `models/gemini-embedding-2` (3072 dimensiones) |
| Base vectorial | Qdrant Cloud, distancia coseno |
| Modelo de lenguaje | Groq, `openai/gpt-oss-20b` |
| Autenticación y datos | Supabase (Auth y PostgreSQL) |

## Estructura

```
PFC-/
├── Backend/
│   ├── app/
│   │   ├── core/         configuración (.env) y seguridad (sesión y roles)
│   │   ├── db/           clientes de Supabase y Qdrant
│   │   ├── routers/      endpoints de chat e ingesta
│   │   ├── services/     pipeline RAG (extracción, limpieza, indexación, consulta)
│   │   └── main.py
│   ├── sql/              scripts para Supabase
│   ├── requirements.txt
│   └── run.bat
├── Frontend/
│   ├── src/
│   │   ├── pages/        Login, Chat e Ingesta
│   │   ├── services/     api.js (llamadas al backend)
│   │   └── ...
│   └── vite.config.js
└── pruebas/              documentos ficticios y plan de pruebas de las 28 preguntas
```

## Requisitos

* Python 3.11 o 3.12
* Node.js 20 o superior y pnpm (`npm install -g pnpm`)
* Cuentas gratuitas en Supabase, Qdrant Cloud, Google AI Studio (clave de Gemini) y Groq

## Instalación

### 1. Supabase

El proyecto usa las tablas `usuario`, `rol`, `estado`, `carrera`, `tipo_documento`, `documento` y `consulta`, y el trigger `handle_new_user()`, que crea la fila en `usuario` cuando alguien se registra. Con las tablas base creadas, ejecuta en el SQL Editor, en este orden:

1. `Backend/sql/consulta.sql`: tabla del historial de consultas.
2. `Backend/sql/ajustes_modelo.sql`: catálogos (roles, estados, tipos de documento), valores por defecto, llaves foráneas e índices. Se puede ejecutar más de una vez.

Los usuarios nuevos se registran como alumnos. Para que alguien pueda subir documentos, dale rol de administrador:

```sql
update public.usuario set rol_id = 3
where id = (select id from auth.users where email = 'correo@ejemplo.com');
```

### 2. Backend

```
cd Backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Completa el `.env` con tus claves:

| Variable | Dónde se obtiene |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | Supabase, Project Settings, API |
| `QDRANT_URL`, `QDRANT_API_KEY` | Qdrant Cloud, en el cluster |
| `QDRANT_COLLECTION_NAME` | El nombre que quieras; se crea sola al iniciar |
| `GEMINI_API_KEY` | Google AI Studio |
| `GROQ_API_KEY` | Consola de Groq |
| `ALLOWED_ORIGINS` | `http://localhost:5173` |
| `UPLOAD_DIR` | `uploads` |
| `SIMILARITY_THRESHOLD` | Opcional, por defecto 0.58 |

Inicia el servidor con `run.bat` (en Linux o Mac: `uvicorn app.main:app --reload --port 8000`). Si todo está bien, `http://localhost:8000/health` responde `{"status": "ok"}` y la documentación de la API queda en `http://localhost:8000/docs`.

### 3. Frontend

```
cd Frontend
pnpm install
copy .env.example .env.local
```

Completa `.env.local` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. En `VITE_API_BASE_URL` puedes dejar `http://localhost:8000` o poner `http://localhost:5173`, que pasa las llamadas por el proxy de Vite hacia el backend.

```
pnpm dev
```

La aplicación queda en `http://localhost:5173`.

## Uso

* **Chat** (todos los roles): preguntas en lenguaje natural. Cada respuesta indica si salió de los documentos o de conocimiento general, las fuentes usadas y el tiempo que tardó; al pasar el mouse por el tiempo se ve cuánto tomó cada etapa. Tus consultas anteriores están en la barra lateral izquierda (se puede plegar), donde puedes fijar las importantes y borrar las que elijas. Abajo está tu perfil, con acceso a la configuración: tema claro, oscuro o del sistema, tamaño del texto, tecla para enviar, fuentes desplegadas, detalles técnicos y borrar todo el historial.
* **Ingesta** (solo administradores): subir uno o varios documentos a la vez y asignarles carrera y descripción. Desde el historial de documentos se puede editar el nombre, la carrera o la descripción, reemplazar el archivo por una versión nueva, descargarlo o eliminarlo.

## Endpoints

Todos piden el token de Supabase en el encabezado `Authorization: Bearer <token>`. El backend valida la firma del token con las llaves públicas del proyecto, sin llamar a Supabase en cada consulta.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/v1/chat/query` | Hacer una consulta |
| POST | `/api/v1/chat/query/stream` | Hacer una consulta con la respuesta en streaming (NDJSON) |
| GET | `/api/v1/chat/models` | Modelos disponibles |
| GET | `/api/v1/chat/history` | Historial del usuario (las fijadas primero) |
| PATCH | `/api/v1/chat/history/{id}` | Fijar o desfijar una consulta |
| POST | `/api/v1/chat/history/delete` | Borrar consultas elegidas o todo el historial |
| POST | `/api/v1/ingest/upload` | Subir un documento (admin) |
| POST | `/api/v1/ingest/documents/{id}/replace` | Reemplazar por una versión nueva (admin) |
| PATCH | `/api/v1/ingest/documents/{id}` | Editar nombre, descripción o carrera (admin) |
| DELETE | `/api/v1/ingest/documents/{id}` | Eliminar documento, vectores y archivo (admin) |
| GET | `/api/v1/ingest/documents/{id}/download` | Descargar el archivo original (admin) |
| GET | `/api/v1/ingest/status/{id}` | Estado de indexación (admin) |
| GET | `/api/v1/ingest/jobs` | Resumen de la cola (admin) |

## Pruebas

En `pruebas/documentos/` hay tres documentos con datos ficticios (malla curricular, reglamento y horarios) para cargar en un entorno de prueba. `pruebas/Plan_de_pruebas_RAG.xlsx` tiene 28 preguntas, 20 dentro del dominio y 8 fuera, con la respuesta esperada y el criterio de calificación.

## Limitaciones conocidas

* La capa gratuita de Groq permite unas 4 o 5 consultas con documentos por minuto y tiene un tope diario de tokens. Al pasarlo aparecen errores 429 y las respuestas se demoran por los reintentos.
* El estado de la cola de indexación vive en memoria; si el backend se reinicia mientras indexa, ese estado se pierde.
* Los archivos subidos se guardan en la carpeta local `uploads` del servidor, así que solo se pueden descargar desde la máquina donde se subieron.
