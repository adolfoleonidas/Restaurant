import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { registerServiceWorker } from "@/lib/serviceWorker";
import { installChunkRecovery } from "@/lib/chunkRecovery";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

// La PWA (caché y pantalla de inicio) se registra después de montar, para que
// nunca retrase el primer render.
registerServiceWorker();

// Una pantalla que no carga porque su archivo ya no existe en el servidor (una
// build vieja guardada por el service worker) deja la app a medias. Esto trae la
// build nueva en lugar de quedarse así. Se instala antes de montar para cubrir
// también los trozos que se piden mucho después.
installChunkRecovery();
