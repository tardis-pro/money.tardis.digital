import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App.js";

async function init() {
  const container = document.getElementById("app");
  if (!container) {
    console.error("#app element not found");
    return;
  }

  const hasContent = container.innerHTML.trim().length > 0;
  
  if (hasContent) {
    hydrateRoot(container, <App />);
  } else {
    createRoot(container).render(<App />);
  }
}

init();
