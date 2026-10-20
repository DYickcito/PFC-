-- =================================================================
-- Ajustes al modelo de datos del módulo RAG (Supabase).
-- Ejecutar en Supabase → SQL Editor, DESPUÉS de consulta.sql.
-- Se puede ejecutar más de una vez sin duplicar nada.
-- =================================================================

-- 1. Catálogos con los IDs y nombres que el backend espera.
--    (security.py: alumno=1, profesor=2, admin=3; ingest.py: estado subido=1
--    y los nombres exactos de tipo_documento). Si ya existen, no se tocan.
insert into public.rol (id, nombre_rol) values
    (1, 'alumno'), (2, 'profesor'), (3, 'admin')
on conflict do nothing;

insert into public.estado (id, nombre_estado) values
    (1, 'subido'), (2, 'activo'), (3, 'inactivo')
on conflict do nothing;

insert into public.tipo_documento (nombre_tipo) values
    ('PDF'), ('Word'), ('Excel'), ('CSV'), ('Txt')
on conflict do nothing;

-- Mantener las secuencias por delante de los IDs insertados a mano.
select setval('rol_id_seq', greatest((select max(id) from public.rol), 1));
select setval('estado_id_seq', greatest((select max(id) from public.estado), 1));

-- 2. Valores por defecto para usuarios nuevos: rol alumno y estado activo.
alter table public.usuario alter column rol_id set default 1;
alter table public.usuario alter column estado_id set default 2;
update public.usuario set rol_id = 1 where rol_id is null;
update public.usuario set estado_id = 2 where estado_id is null;

-- Documentos nuevos: estado subido por defecto.
alter table public.documento alter column id_estado set default 1;

-- 3. Qué pasa al borrar:
--    al eliminar un usuario en Supabase Auth se elimina su fila en usuario;
--    sus documentos se conservan y quedan sin autor (id_usuario en null).
alter table public.usuario drop constraint if exists usuario_id_fkey;
alter table public.usuario
    add constraint usuario_id_fkey
    foreign key (id) references auth.users (id) on delete cascade;

alter table public.documento drop constraint if exists documento_id_usuario_fkey;
alter table public.documento
    add constraint documento_id_usuario_fkey
    foreign key (id_usuario) references public.usuario (id) on delete set null;

-- 4. Índices para el historial de documentos del panel (orden por fecha y
--    filtro por carrera).
create index if not exists documento_fecha_carga_idx on public.documento (fecha_carga desc);
create index if not exists documento_id_carrera_idx on public.documento (id_carrera);
