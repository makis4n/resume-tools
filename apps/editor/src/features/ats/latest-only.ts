export interface Run {
  /** Aborted when a newer run starts or the runs are cancelled. */
  signal: AbortSignal;
  /** True until a newer run starts or the runs are cancelled; only then may its result be shown. */
  isCurrent: () => boolean;
}

/**
 * Hands out one run at a time: starting a run cancels the one before it, so an older result that
 * arrives late is never shown over a newer one (docs/ats-prd.md, section 7.2).
 */
export function latestOnly() {
  let current: AbortController | null = null;
  return {
    start(): Run {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return {
        signal: controller.signal,
        isCurrent: () => current === controller && !controller.signal.aborted,
      };
    },
    cancel(): void {
      current?.abort();
    },
  };
}
