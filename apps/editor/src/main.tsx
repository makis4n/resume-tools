import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ImportMeasurePage, measuredImport } from "./measure/ImportMeasurePage";
import { MeasurePage, measuredTemplate } from "./measure/MeasurePage";

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html is missing the #root element");
}

// `?measure=1` shows the measurement page instead of the editor (decision 0016), and
// `?measure=import` the import's (decision 0045).
const search = window.location.search;
const imported = measuredImport(search);
const measured = imported === undefined ? measuredTemplate(search) : undefined;

createRoot(root).render(
  <StrictMode>
    {imported !== undefined ? (
      <ImportMeasurePage engine={imported} />
    ) : measured !== undefined ? (
      <MeasurePage template={measured} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
