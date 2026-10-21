/**
 * Estado del historial de consultas del usuario (tabla `consulta` vía backend).
 * Lo usan la barra lateral (lista, fijar, borrar elegidas) y la ventana de
 * configuración (borrar todo). El chat llama a `cargar` cuando termina una
 * respuesta para que la consulta nueva aparezca en la lista.
 */
import { useCallback, useEffect, useState } from "react";
import { deleteHistory, getChatHistory, pinHistoryItem } from "../services/api";

/* Fijadas primero; dentro de cada grupo, de la más reciente a la más antigua */
export function ordenarHistorial(lista) {
  return [...lista].sort(
    (a, b) => Number(!!b.fijada) - Number(!!a.fijada) || new Date(b.fecha) - new Date(a.fecha)
  );
}

function mensajeDeError(err, porDefecto) {
  // Sin respuesta o 502/503/504 del proxy de Vite: el backend no está encendido
  if (!err.response || [502, 503, 504].includes(err.response.status)) {
    return "No se pudo conectar con el servidor. Revisa que el backend esté encendido.";
  }
  return err.response.data?.detail ?? porDefecto;
}

export function useHistorial(limite = 50) {
  const [items, setItems] = useState([]);
  const [estado, setEstado] = useState("idle"); // idle | loading | ok | error
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    setEstado((prev) => (prev === "ok" ? "ok" : "loading"));
    try {
      const res = await getChatHistory(limite);
      setItems(ordenarHistorial(res.data.consultas ?? []));
      setEstado("ok");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo cargar el historial."));
      setEstado("error");
    }
  }, [limite]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // El aviso (por ejemplo "Se borraron 3 consultas") se borra solo
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  /* Fijar o desfijar: se actualiza al instante y se revierte si el servidor falla */
  const fijar = useCallback(async (consulta) => {
    const fijada = !consulta.fijada;
    const cambiar = (valor) =>
      setItems((prev) => ordenarHistorial(prev.map((h) => (h.id === consulta.id ? { ...h, fijada: valor } : h))));
    cambiar(fijada);
    try {
      await pinHistoryItem(consulta.id, fijada);
    } catch (err) {
      cambiar(!fijada);
      setAviso(mensajeDeError(err, "No se pudo fijar la consulta."));
    }
  }, []);

  /* Borrar: { ids: [...] } para las elegidas o { todas: true } para todo menos las fijadas */
  const borrar = useCallback(
    async (opciones) => {
      try {
        const res = await deleteHistory(opciones);
        const n = res.data.borradas ?? 0;
        setAviso(n === 1 ? "Se borró 1 consulta." : `Se borraron ${n} consultas.`);
        await cargar();
        return true;
      } catch (err) {
        setAviso(mensajeDeError(err, "No se pudo borrar el historial."));
        return false;
      }
    },
    [cargar]
  );

  return { items, estado, error, aviso, cargar, fijar, borrar };
}
