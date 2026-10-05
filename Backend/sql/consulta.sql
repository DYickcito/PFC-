-- =================================================================
-- Tabla `consulta`: historial de consultas del chat RAG.
-- Ejecutar una sola vez en Supabase → SQL Editor.
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
