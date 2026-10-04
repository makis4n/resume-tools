/**
 * pdf.js's worker module, which `pdfjs-dist` ships without types: what the tests use of it, the
 * handler that answers the page's side over a port, as the worker the page starts does.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: {
    initializeFromPort(port: MessagePort): void;
  };
}
