import analysisSchema from "@resume-tools/contracts/ats/v1/analysis.schema.json";
import errorSchema from "@resume-tools/contracts/ats/v1/error.schema.json";
import Ajv2020 from "ajv/dist/2020";

/**
 * TypeScript view of `packages/contracts/ats/v1`. The schemas are the truth; these types only
 * describe what validation has already guaranteed.
 */
export type Severity = "info" | "warning" | "critical";

export interface Finding {
  id: string;
  severity: Severity;
  message: string;
  page?: number;
  suggestion?: string;
}

export interface Analysis {
  contract: "ats/v1";
  score: number | null;
  findings: Finding[];
}

export interface ServiceErrorBody {
  error: { code: string; message: string };
}

// `removeAdditional` drops properties the schema does not know before validating, so a service
// that has deployed a new field does not fail an older client (decision 0006).
const ajv = new Ajv2020({ removeAdditional: true });
const analysisValidator = ajv.compile<Analysis>(analysisSchema);
const errorValidator = ajv.compile<ServiceErrorBody>(errorSchema);

export function isAnalysis(value: unknown): value is Analysis {
  return analysisValidator(value);
}

export function isServiceError(value: unknown): value is ServiceErrorBody {
  return errorValidator(value);
}
