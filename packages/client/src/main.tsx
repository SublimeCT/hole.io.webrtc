import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing application mount point");
}

createRoot(root).render(<App />);
