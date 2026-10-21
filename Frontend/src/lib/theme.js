/**
 * Tema de la interfaz: claro, oscuro o el del sistema operativo.
 *
 * La elección se guarda en localStorage ("tema") y se aplica con el atributo
 * data-theme en <html>. Con "system" se quita el atributo y index.css usa
 * prefers-color-scheme. index.html aplica el tema guardado antes de pintar,
 * para evitar un parpadeo al cargar.
 */
import { useCallback, useEffect, useState } from "react";

const CLAVE = "tema";
export const TEMAS = ["light", "dark", "system"];

function leerTema() {
  try {
    const t = localStorage.getItem(CLAVE);
    return TEMAS.includes(t) ? t : "system";
  } catch {
    return "system";
  }
}

function aplicarTema(tema) {
  const raiz = document.documentElement;
  if (tema === "system") delete raiz.dataset.theme;
  else raiz.dataset.theme = tema;
}

export function useTheme() {
  const [tema, setTemaState] = useState(leerTema);

  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);

  // Si el usuario cambia el tema en otra pestaña, esta también se actualiza
  useEffect(() => {
    const alCambiar = (e) => {
      if (e.key === CLAVE) setTemaState(leerTema());
    };
    window.addEventListener("storage", alCambiar);
    return () => window.removeEventListener("storage", alCambiar);
  }, []);

  const setTema = useCallback((nuevo) => {
    try {
      localStorage.setItem(CLAVE, nuevo);
    } catch {
      /* sin localStorage el tema dura solo esta sesión */
    }
    setTemaState(nuevo);
  }, []);

  return [tema, setTema];
}
