-- =================================================================
-- Tabla `consulta`: historial de consultas del chat RAG.
-- Ejecutar en Supabase → SQL Editor. Se puede volver a ejecutar sin
-- perder datos: solo agrega lo que falte.
-- El backend escribe con la service_role_key (no depende de RLS);
-- la política permite que cada usuario lea solo sus propias consultas
-- si en el futuro el frontend las consulta directo.
-- =================================================================

create table if not exists public.consulta (
    id            uuid primary key default gen_random_uuid(),
    id_usuario    uuid not null references public.usuario (id) on delete cascade,
    pregunta      text not null,
    respuesta     text not null,
    modelo        text not null,
    uso_contexto  boolean not null,          -- true: respondió con documentos oficiales
    score_max     double precision,          -- puntaje del fragmento más parecido
    fragmentos    integer not null default 0, -- fragmentos usados como contexto
    tiempo_ms     integer,                   -- duración total de la consulta
    fecha         timestamptz not null default now()
);

create index if not exists consulta_usuario_fecha_idx
    on public.consulta (id_usuario, fecha desc);

alter table public.consulta enable row level security;

drop policy if exists "Cada usuario lee sus consultas" on public.consulta;
create policy "Cada usuario lee sus consultas"
    on public.consulta for select
    using (auth.uid() = id_usuario);

-- Consultas fijadas: el usuario las marca para que no se borren con
-- "Borrar historial" y aparezcan primero en el panel.
alter table public.consulta add column if not exists fijada boolean not null default false;

create index if not exists consulta_usuario_fijada_fecha_idx
    on public.consulta (id_usuario, fijada desc, fecha desc);

-- Cada usuario puede fijar y borrar solo sus consultas (si el frontend
-- llegara a usar Supabase directo; el backend no depende de RLS).
drop policy if exists "Cada usuario actualiza sus consultas" on public.consulta;
create policy "Cada usuario actualiza sus consultas"
    on public.consulta for update
    using (auth.uid() = id_usuario);

drop policy if exists "Cada usuario borra sus consultas" on public.consulta;
create policy "Cada usuario borra sus consultas"
    on public.consulta for delete
    using (auth.uid() = id_usuario);
