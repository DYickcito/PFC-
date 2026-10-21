import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { PreferenciasProvider } from "./lib/preferencias.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <PreferenciasProvider>
        <App />
      </PreferenciasProvider>
    </AuthProvider>
  </StrictMode>
);
