import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { applyDocumentLanguage } from "./app/i18n";
import { loadPreferences } from "./app/preferences";
import "./style.css";
import "./styles/home.css";
import "./styles/online-room.css";
import "./styles/game.css";
import "./styles/results.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing application mount point");
}

applyDocumentLanguage(loadPreferences().language);

createRoot(root).render(<App />);
