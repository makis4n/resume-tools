# ATS panel

The panel that sends the current resume's PDF to the ATS service and shows the analysis.

It depends on `packages/contracts/ats/v1` and on the service's address in `VITE_ATS_SERVICE_URL`, and on nothing else inside the ATS. Both of us own this folder. What it will become is in `docs/ats-prd.md` and decision 0007.

- `client.ts` posts a PDF to `POST /v1/analyze` and returns either an analysis or a failure the UI can explain. Every reply is validated against the contract first; the contract accepts properties it does not list, and the client ignores them.
- `contract.ts` compiles the contract's schemas with Ajv and holds the matching TypeScript types.
- `panel-state.ts` is the panel's state machine, kept pure so it can be tested without a DOM.
- `latest-only.ts` keeps one request at a time: a newer one cancels the older, whose result is ignored.
- `AtsPanel.tsx` is the panel. For now the app mounts it in development only, with the invented PDF from `sample-pdf.ts`, until the compile path exposes the real one.

`client.integration.test.ts` runs against a live service when `ATS_INTEGRATION_URL` is set:

```sh
(cd apps/ats && uv run ats-serve)
ATS_INTEGRATION_URL=http://localhost:8000 pnpm --filter @resume-tools/editor test
```
