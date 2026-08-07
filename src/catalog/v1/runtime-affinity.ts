import type { BundleVersion, RuntimeAffinityScope } from './types.js';

export interface RuntimeAffinityValidationIssue {
  code: 'missing-reference' | 'duplicate-binding' | 'future-step-binding';
  path: string;
  message: string;
}

export interface RuntimeAffinityValidationResult {
  valid: boolean;
  issues: RuntimeAffinityValidationIssue[];
}

/**
 * Definition-level rule: a target bundle step may require the same stable
 * account affinity that was used by an earlier source step. This is not a
 * request to keep the source browser/profile session alive.
 */
export function validateRuntimeAffinityBindings(
  bundle: BundleVersion,
): RuntimeAffinityValidationResult {
  const issues: RuntimeAffinityValidationIssue[] = [];
  const steps = new Map(bundle.steps.map((step) => [step.id, step]));

  for (const step of bundle.steps) {
    const seenScopes = new Set<RuntimeAffinityScope>();
    for (const binding of step.runtimeAffinityBindings) {
      const path = `bundleVersions.${bundle.id}.steps.${step.id}.runtimeAffinityBindings.${binding.id}`;
      if (seenScopes.has(binding.scope)) {
        issues.push({
          code: 'duplicate-binding',
          path,
          message: `step has more than one ${binding.scope} runtime affinity binding`,
        });
      }
      seenScopes.add(binding.scope);

      const sourceStep = steps.get(binding.sourceStepId);
      if (!sourceStep) {
        issues.push({
          code: 'missing-reference',
          path: `${path}.sourceStepId`,
          message: `runtime affinity source step ${binding.sourceStepId} does not exist`,
        });
        continue;
      }
      if (sourceStep.stepOrder >= step.stepOrder) {
        issues.push({
          code: 'future-step-binding',
          path: `${path}.sourceStepId`,
          message: 'runtime affinity may bind only to an earlier ordered step',
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Execution-local persisted affinity. `affinityRef` is an opaque owner-issued
 * reference that is safe for Z-X to persist and can be presented to the
 * account/runtime allocator to reacquire the same provider account later.
 * It is not a cookie, profile path, credential, or live browser-session ID.
 */
export interface ExecutionStepRuntimeAffinity {
  id: string;
  executionId: string;
  targetStepInstanceId: string;
  sourceStepInstanceId: string;
  sourceStepAttemptId: string;
  scope: RuntimeAffinityScope;
  affinityRef: string;
  boundAt: string;
}

/**
 * One attempt receives a short-lived runtime binding. Every script invocation
 * must release that binding before returning DONE, POLLING, or FAILED.
 */
export interface StepAttemptRuntimeBinding {
  stepAttemptId: string;
  runtimeAffinityRef: string | null;
  runtimeBindingRef: string | null;
  acquiredAt: string | null;
  releasedAt: string | null;
}
