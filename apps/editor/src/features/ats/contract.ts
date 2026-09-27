import analysisSchema from "@resume-tools/contracts/ats/v1/analysis.schema.json";
import errorSchema from "@resume-tools/contracts/ats/v1/error.schema.json";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";

/**
 * TypeScript view of `packages/contracts/ats/v1`. The schemas are the truth; these types only
 * describe what validation has already guaranteed. The schemas accept properties they do not
 * list (decision 0030), so a reply may carry more than these types show, and code here ignores it.
 */
export type Severity = "info" | "warning" | "critical";

export type Origin = "content" | "layout";

export type Producer = "latex" | "word" | "google-docs" | "canva" | "other";

export interface Finding {
  id: string;
  severity: Severity;
  origin?: Origin;
  message: string;
  page?: number;
  suggestion?: string;
}

export interface Analysis {
  contract: "ats/v1";
  score: number | null;
  findings: Finding[];
  producer?: Producer;
  rubric_version?: string;
  analyser_version?: string;
}

export interface ServiceErrorBody {
  error: { code: string; message: string };
}

// Compiled on first use rather than at import: Ajv generates code with `new Function`, and the
// app should not pay for that, or depend on it being allowed, until someone runs an analysis. The
// client calls prepareValidators before uploading, so a failure to compile costs no upload.
let validators: {
  analysis: ValidateFunction<Analysis>;
  error: ValidateFunction<ServiceErrorBody>;
} | null = null;

/** The compiled validators, compiling them on the first call. Throws if they cannot be compiled. */
export function prepareValidators() {
  if (!validators) {
    const ajv = new Ajv2020();
    validators = {
      analysis: ajv.compile<Analysis>(analysisSchema),
      error: ajv.compile<ServiceErrorBody>(errorSchema),
    };
  }
  return validators;
}

export function isAnalysis(value: unknown): value is Analysis {
  return prepareValidators().analysis(value);
}

export function isServiceError(value: unknown): value is ServiceErrorBody {
  return prepareValidators().error(value);
}
