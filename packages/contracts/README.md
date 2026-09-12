# contracts

JSON Schemas for everything that crosses between the editor and the ATS service. Both of us own this folder, and every change here is reviewed by both.

Rules:

- One folder per service and version: `ats/v1/`, later `ats/v2/`.
- Additive changes stay in the same version. A change that would break a consumer starts a new version next to the old one, and the old one stays until nothing uses it.
- The schema is the truth. If the service and the schema disagree, the service is wrong.

Current: `ats/v1/analysis.schema.json`, the response of `POST /v1/analyze`. It is a draft until both owners mark it stable.
