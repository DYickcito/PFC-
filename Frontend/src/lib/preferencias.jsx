/**
 * Preferencias del usuario para la interfaz (se guardan en este navegador).
 *
 *   enterEnvia      true: Enter envía y Shift + Enter salta de línea.
 *                   false: Enter salta de línea y Ctrl + Enter envía.
 *   fuentesAbiertas Mostrar las fuentes citadas ya desplegadas.
 *   datosTecnicos   Mostrar modelo, tiempos y porcentaje de similitud.
 *   textoChat       Tamaño del texto de los mensajes: pequeno, normal o grande.
 *
 * El tema (claro, oscuro, sistema) vive aparte, en theme.js.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

const CLAVE = "preferencias";

const POR_DEFECTO = {
  enterEnvia: true,
  fuentesAbiertas: false,
  datosTecnicos: true,
  textoChat: "normal",
};

export const TAMANOS_TEXTO = {
  pequeno: 12,
  normal: 13,
  grande: 15,
};

function leer() {
  try {
    const guardadas = JSON.parse(localStorage.getItem(CLAVE) || "{}");
    return { ...POR_DEFECTO, ...guardadas };
  } catch {
    return { ...POR_DEFECTO };
  }
}

const PreferenciasContext = createContext(null);

export function PreferenciasProvider({ children }) {
  const [prefs, setPrefs] = useState(leer);

  // El tamaño del texto del chat se aplica con una variable CSS
  useEffect(() => {
    const px = TAMANOS_TEXTO[prefs.textoChat] ?? TAMANOS_TEXTO.normal;
    document.documentElement.style.setProperty("--chat-font", `${px}px`);
  }, [prefs.textoChat]);

  const setPref = useCallback((clave, valor) => {
    setPrefs((prev) => {
      const nuevas = { ...prev, [clave]: valor };
      try {
        localStorage.setItem(CLAVE, JSON.stringify(nuevas));
      } catch {
        /* sin localStorage la preferencia dura solo esta sesión */
      }
      return nuevas;
    });
  }, []);

  return (
    <PreferenciasContext.Provider value={{ prefs, setPref }}>
      {children}
    </PreferenciasContext.Provider>
  );
}

export function usePreferencias() {
  const ctx = useContext(PreferenciasContext);
  if (!ctx) throw new Error("usePreferencias debe usarse dentro de <PreferenciasProvider>");
  return ctx;
}
