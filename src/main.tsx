import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { toast } from "sonner";

// Register service worker for PWA with manual update prompt
if ("serviceWorker" in navigator) {
  const acknowledgedVersion = sessionStorage.getItem("ph_sw_ack_version");

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`/sw.js?v=${Date.now()}`, { updateViaCache: "none" })
      .then((reg) => {
        reg.update();
        setInterval(() => reg.update(), 30 * 1000);
      })
      .catch((err) => {
        console.log("SW registration failed:", err);
      });
  });

  // Listen for SW update messages -> show toast with "Reload" action
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data;
    if (data?.type === "SW_UPDATED" && acknowledgedVersion !== data.version) {
      toast("🚀 Доступна новая версия ProHub", {
        description: `Обновление ${data.version} готово. Перезагрузите страницу, чтобы применить.`,
        duration: 30000,
        action: {
          label: "Обновить",
          onClick: () => {
            sessionStorage.setItem("ph_sw_ack_version", data.version);
            window.location.reload();
          },
        },
        cancel: {
          label: "Позже",
          onClick: () => {
            sessionStorage.setItem("ph_sw_ack_version", data.version);
          },
        },
      });
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
