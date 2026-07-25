import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./style.css";
import "./styles/home.css";
import "./styles/game.css";
import "./styles/results.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing application mount point");
}

createRoot(root).render(<App />);
