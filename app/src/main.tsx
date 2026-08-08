import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { iniciarSincronizacao } from "./lib/fila";
import "./index.css";

// A fila começa a rodar antes de qualquer tela: se o app foi fechado com
// séries pendentes, elas sobem assim que abre.
iniciarSincronizacao();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
