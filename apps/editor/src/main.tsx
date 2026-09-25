import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MeasurePage, measuredTemplate } from "./measure/MeasurePage";

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html is missing the #root element");
}

// `?measure=1` shows the measurement page instead of the editor (decision 0016).
const measured = measuredTemplate(window.location.search);

createRoot(root).render(
  <StrictMode>{measured === undefined ? <App /> : <MeasurePage template={measured} />}</StrictMode>,
);
