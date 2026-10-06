import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ImportMeasurePage, measuredImport } from "./measure/ImportMeasurePage";
import { ImportTypingPage, measuredImportTyping } from "./measure/ImportTypingPage";
import { MeasurePage, measuredTemplate } from "./measure/MeasurePage";
import { measuredPdfImport, PdfMeasurePage } from "./measure/PdfMeasurePage";

const root = document.getElementById("root");
if (!root) {
  throw new Error("index.html is missing the #root element");
}

// `?measure=1` shows the measurement page instead of the editor (decision 0016),
// `?measure=import` the import's (decision 0045), `?measure=import-pdf` a PDF import's by rules,
// and `?measure=import-typing` typing on the imported upstream samples.
const search = window.location.search;
const pdf = measuredPdfImport(search);
const typing = pdf ? undefined : measuredImportTyping(search);
const imported = pdf || typing !== undefined ? undefined : measuredImport(search);
const measured =
  pdf || typing !== undefined || imported !== undefined ? undefined : measuredTemplate(search);

createRoot(root).render(
  <StrictMode>
    {pdf ? (
      <PdfMeasurePage />
    ) : typing !== undefined ? (
      <ImportTypingPage samples={typing} />
    ) : imported !== undefined ? (
      <ImportMeasurePage engine={imported} />
    ) : measured !== undefined ? (
      <MeasurePage template={measured} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
