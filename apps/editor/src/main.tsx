import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ImportMeasurePage, measuredImport } from "./measure/ImportMeasurePage";
import { MeasurePage, measuredTemplate } from "./measure/MeasurePage";
import { measuredPdfImport, PdfMeasurePage } from "./measure/PdfMeasurePage";

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html is missing the #root element");
}

// `?measure=1` shows the measurement page instead of the editor (decision 0016),
// `?measure=import` the import's (decision 0045), and `?measure=import-pdf` a PDF import's by rules.
const search = window.location.search;
const pdf = measuredPdfImport(search);
const imported = pdf ? undefined : measuredImport(search);
const measured = pdf || imported !== undefined ? undefined : measuredTemplate(search);

createRoot(root).render(
  <StrictMode>
    {pdf ? (
      <PdfMeasurePage />
    ) : imported !== undefined ? (
      <ImportMeasurePage engine={imported} />
    ) : measured !== undefined ? (
      <MeasurePage template={measured} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
