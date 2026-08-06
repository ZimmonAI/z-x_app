import type {
  BundleStep,
  BundleVersion,
  CatalogSnapshot,
  ManifestUsage,
  ScriptVersion,
} from './types.js';

export type CatalogValidationCode =
  | 'missing-reference'
  | 'duplicate-key'
  | 'invalid-cardinality'
  | 'invalid-order'
  | 'invalid-policy'
  | 'missing-binding'
  | 'duplicate-binding'
  | 'binding-type-mismatch'
  | 'future-step-binding'
  | 'publication-gate';

export interface CatalogValidationIssue {
  code: CatalogValidationCode;
  path: string;
  message: string;
}

export interface CatalogValidationResult {
  valid: boolean;
  issues: CatalogValidationIssue[];
}

function addIssue(
  issues: CatalogValidationIssue[],
  code: CatalogValidationCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function validateUsage(
  usage: ManifestUsage,
  path: string,
  manifestVersionIds: Set<string>,
  issues: CatalogValidationIssue[],
): void {
  if (!manifestVersionIds.has(usage.manifestVersionId)) {
    addIssue(
      issues,
      'missing-reference',
      `${path}.manifestVersionId`,
      `manifest version ${usage.manifestVersionId} does not exist`,
    );
  }
  if (!Number.isInteger(usage.minItems) || !Number.isInteger(usage.maxItems)) {
    addIssue(issues, 'invalid-cardinality', path, 'cardinality must use integers');
  } else if (
    usage.minItems < 0 ||
    usage.maxItems < 1 ||
    usage.minItems > usage.maxItems ||
    (usage.required && usage.minItems < 1) ||
    (!usage.required && usage.minItems !== 0)
  ) {
    addIssue(
      issues,
      'invalid-cardinality',
      path,
      'required usages need minItems >= 1; optional usages need minItems = 0; maxItems must be bounded',
    );
  }
  if (!Number.isInteger(usage.sortOrder) || usage.sortOrder < 1) {
    addIssue(issues, 'invalid-order', `${path}.sortOrder`, 'sort order must be a positive integer');
  }
}

function validateUniqueValues(
  values: string[],
  path: string,
  label: string,
  issues: CatalogValidationIssue[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      addIssue(issues, 'duplicate-key', path, `duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function validateScriptVersion(
  script: ScriptVersion,
  snapshot: CatalogSnapshot,
  issues: CatalogValidationIssue[],
): void {
  const path = `scriptVersions.${script.id}`;
  const manifestVersionIds = new Set(snapshot.manifestVersions.map((version) => version.id));
  if (!snapshot.scriptDefinitions.some((definition) => definition.id === script.scriptDefinitionId)) {
    addIssue(
      issues,
      'missing-reference',
      `${path}.scriptDefinitionId`,
      `script definition ${script.scriptDefinitionId} does not exist`,
    );
  }
  if (!snapshot.runtimePackages.some((runtimePackage) => runtimePackage.id === script.runtimePackageId)) {
    addIssue(
      issues,
      'missing-reference',
      `${path}.runtimePackageId`,
      `runtime package ${script.runtimePackageId} does not exist`,
    );
  }
  validateUniqueValues(
    script.inputUsages.map((usage) => usage.id),
    `${path}.inputUsages`,
    'input usage id',
    issues,
  );
  validateUniqueValues(
    script.inputUsages.map((usage) => usage.usageKey),
    `${path}.inputUsages`,
    'input usage key',
    issues,
  );
  validateUniqueValues(
    script.outputUsages.map((usage) => usage.id),
    `${path}.outputUsages`,
    'output usage id',
    issues,
  );
  validateUniqueValues(
    script.outputUsages.map((usage) => usage.usageKey),
    `${path}.outputUsages`,
    'output usage key',
    issues,
  );
  script.inputUsages.forEach((usage, index) =>
    validateUsage(usage, `${path}.inputUsages.${index}`, manifestVersionIds, issues),
  );
  script.outputUsages.forEach((usage, index) =>
    validateUsage(usage, `${path}.outputUsages.${index}`, manifestVersionIds, issues),
  );
}

function validateStepPolicy(
  step: BundleStep,
  path: string,
  issues: CatalogValidationIssue[],
): void {
  const { policy } = step;
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    addIssue(issues, 'invalid-policy', `${path}.policy.maxAttempts`, 'maxAttempts must be positive');
  }
  if (
    !Number.isInteger(policy.nextAttemptIntervalSeconds) ||
    policy.nextAttemptIntervalSeconds < 0
  ) {
    addIssue(
      issues,
      'invalid-policy',
      `${path}.policy.nextAttemptIntervalSeconds`,
      'nextAttemptIntervalSeconds must be a non-negative integer',
    );
  }
  if (!Number.isInteger(policy.maxScriptRuntimeSeconds) || policy.maxScriptRuntimeSeconds < 1) {
    addIssue(
      issues,
      'invalid-policy',
      `${path}.policy.maxScriptRuntimeSeconds`,
      'maxScriptRuntimeSeconds must be positive',
    );
  }
  if (!Number.isInteger(policy.leaseSeconds) || policy.leaseSeconds < 1) {
    addIssue(issues, 'invalid-policy', `${path}.policy.leaseSeconds`, 'leaseSeconds must be positive');
  } else if (policy.leaseSeconds < policy.maxScriptRuntimeSeconds) {
    addIssue(
      issues,
      'invalid-policy',
      `${path}.policy.leaseSeconds`,
      'leaseSeconds must cover the maximum script runtime',
    );
  }
}

function usageById(script: ScriptVersion, usageId: string, direction: 'input' | 'output') {
  const usages = direction === 'input' ? script.inputUsages : script.outputUsages;
  return usages.find((usage) => usage.id === usageId);
}

function validateBundleBindings(
  bundle: BundleVersion,
  snapshot: CatalogSnapshot,
  issues: CatalogValidationIssue[],
): void {
  const scripts = new Map(snapshot.scriptVersions.map((script) => [script.id, script]));
  const steps = new Map(bundle.steps.map((step) => [step.id, step]));
  const bundleInputs = new Map(bundle.inputUsages.map((usage) => [usage.id, usage]));
  const bundleOutputs = new Map(bundle.outputUsages.map((usage) => [usage.id, usage]));

  for (const step of bundle.steps) {
    const path = `bundleVersions.${bundle.id}.steps.${step.id}`;
    const script = scripts.get(step.scriptVersionId);
    if (!script) {
      addIssue(
        issues,
        'missing-reference',
        `${path}.scriptVersionId`,
        `script version ${step.scriptVersionId} does not exist`,
      );
      continue;
    }

    const targetCounts = new Map<string, number>();
    for (const binding of step.inputBindings) {
      const bindingPath = `${path}.inputBindings.${binding.id}`;
      const target = usageById(script, binding.targetScriptInputUsageId, 'input');
      if (!target) {
        addIssue(
          issues,
          'missing-reference',
          `${bindingPath}.targetScriptInputUsageId`,
          'target input usage does not belong to the linked script version',
        );
        continue;
      }
      targetCounts.set(target.id, (targetCounts.get(target.id) ?? 0) + 1);
      if (!Number.isInteger(binding.bindingOrder) || binding.bindingOrder < 1) {
        addIssue(
          issues,
          'invalid-order',
          `${bindingPath}.bindingOrder`,
          'binding order must be a positive integer',
        );
      }

      if (binding.source.kind === 'bundle-input') {
        const source = bundleInputs.get(binding.source.bundleInputUsageId);
        if (!source) {
          addIssue(
            issues,
            'missing-reference',
            `${bindingPath}.source`,
            'bundle input source does not exist',
          );
        } else if (source.manifestVersionId !== target.manifestVersionId) {
          addIssue(
            issues,
            'binding-type-mismatch',
            `${bindingPath}.source`,
            'bundle input and script input must use the same manifest version',
          );
        }
      } else if (binding.source.kind === 'step-output') {
        const sourceStep = steps.get(binding.source.sourceStepId);
        if (!sourceStep) {
          addIssue(
            issues,
            'missing-reference',
            `${bindingPath}.source`,
            'source step does not exist',
          );
          continue;
        }
        if (sourceStep.stepOrder >= step.stepOrder) {
          addIssue(
            issues,
            'future-step-binding',
            `${bindingPath}.source`,
            'step input may bind only to an earlier ordered step',
          );
        }
        const sourceScript = scripts.get(sourceStep.scriptVersionId);
        const sourceOutput = sourceScript
          ? usageById(sourceScript, binding.source.sourceScriptOutputUsageId, 'output')
          : undefined;
        if (!sourceOutput) {
          addIssue(
            issues,
            'missing-reference',
            `${bindingPath}.source`,
            'source output usage does not belong to the source step script version',
          );
        } else if (sourceOutput.manifestVersionId !== target.manifestVersionId) {
          addIssue(
            issues,
            'binding-type-mismatch',
            `${bindingPath}.source`,
            'prior-step output and target input must use the same manifest version',
          );
        }
      }
    }

    for (const input of script.inputUsages) {
      const count = targetCounts.get(input.id) ?? 0;
      if (input.required && count === 0) {
        addIssue(
          issues,
          'missing-binding',
          `${path}.inputBindings`,
          `required script input ${input.usageKey} is not bound`,
        );
      }
      if (count > 1) {
        addIssue(
          issues,
          'duplicate-binding',
          `${path}.inputBindings`,
          `script input ${input.usageKey} has more than one normalized binding`,
        );
      }
    }
  }

  const finalCounts = new Map<string, number>();
  for (const binding of bundle.finalOutputBindings) {
    const path = `bundleVersions.${bundle.id}.finalOutputBindings.${binding.id}`;
    const target = bundleOutputs.get(binding.bundleOutputUsageId);
    const sourceStep = steps.get(binding.sourceStepId);
    if (!target) {
      addIssue(issues, 'missing-reference', `${path}.bundleOutputUsageId`, 'bundle output does not exist');
      continue;
    }
    finalCounts.set(target.id, (finalCounts.get(target.id) ?? 0) + 1);
    if (!sourceStep) {
      addIssue(issues, 'missing-reference', `${path}.sourceStepId`, 'source step does not exist');
      continue;
    }
    const sourceScript = scripts.get(sourceStep.scriptVersionId);
    const sourceOutput = sourceScript
      ? usageById(sourceScript, binding.sourceScriptOutputUsageId, 'output')
      : undefined;
    if (!sourceOutput) {
      addIssue(
        issues,
        'missing-reference',
        `${path}.sourceScriptOutputUsageId`,
        'source output does not belong to the source step script version',
      );
    } else if (sourceOutput.manifestVersionId !== target.manifestVersionId) {
      addIssue(
        issues,
        'binding-type-mismatch',
        path,
        'final output and source script output must use the same manifest version',
      );
    }
  }

  for (const output of bundle.outputUsages) {
    const count = finalCounts.get(output.id) ?? 0;
    if (output.required && count === 0) {
      addIssue(
        issues,
        'missing-binding',
        `bundleVersions.${bundle.id}.finalOutputBindings`,
        `required bundle output ${output.usageKey} is not bound`,
      );
    }
    if (count > 1) {
      addIssue(
        issues,
        'duplicate-binding',
        `bundleVersions.${bundle.id}.finalOutputBindings`,
        `bundle output ${output.usageKey} has more than one final binding`,
      );
    }
  }
}

export function validateBundleVersion(
  snapshot: CatalogSnapshot,
  bundle: BundleVersion,
): CatalogValidationResult {
  const issues: CatalogValidationIssue[] = [];
  const manifestVersionIds = new Set(snapshot.manifestVersions.map((version) => version.id));

  for (const script of snapshot.scriptVersions) {
    validateScriptVersion(script, snapshot, issues);
  }

  if (!snapshot.bundleDefinitions.some((definition) => definition.id === bundle.bundleDefinitionId)) {
    addIssue(
      issues,
      'missing-reference',
      `bundleVersions.${bundle.id}.bundleDefinitionId`,
      `bundle definition ${bundle.bundleDefinitionId} does not exist`,
    );
  }

  validateUniqueValues(
    bundle.inputUsages.map((usage) => usage.id),
    `bundleVersions.${bundle.id}.inputUsages`,
    'bundle input usage id',
    issues,
  );
  validateUniqueValues(
    bundle.inputUsages.map((usage) => usage.usageKey),
    `bundleVersions.${bundle.id}.inputUsages`,
    'bundle input usage key',
    issues,
  );
  validateUniqueValues(
    bundle.outputUsages.map((usage) => usage.id),
    `bundleVersions.${bundle.id}.outputUsages`,
    'bundle output usage id',
    issues,
  );
  validateUniqueValues(
    bundle.outputUsages.map((usage) => usage.usageKey),
    `bundleVersions.${bundle.id}.outputUsages`,
    'bundle output usage key',
    issues,
  );
  bundle.inputUsages.forEach((usage, index) =>
    validateUsage(
      usage,
      `bundleVersions.${bundle.id}.inputUsages.${index}`,
      manifestVersionIds,
      issues,
    ),
  );
  bundle.outputUsages.forEach((usage, index) =>
    validateUsage(
      usage,
      `bundleVersions.${bundle.id}.outputUsages.${index}`,
      manifestVersionIds,
      issues,
    ),
  );

  if (bundle.steps.length === 0) {
    addIssue(issues, 'invalid-order', `bundleVersions.${bundle.id}.steps`, 'bundle needs at least one step');
  }
  validateUniqueValues(
    bundle.steps.map((step) => step.id),
    `bundleVersions.${bundle.id}.steps`,
    'step id',
    issues,
  );
  validateUniqueValues(
    bundle.steps.map((step) => step.stepKey),
    `bundleVersions.${bundle.id}.steps`,
    'step key',
    issues,
  );
  validateUniqueValues(
    bundle.steps.map((step) => String(step.stepOrder)),
    `bundleVersions.${bundle.id}.steps`,
    'step order',
    issues,
  );
  const ordered = [...bundle.steps].sort((left, right) => left.stepOrder - right.stepOrder);
  ordered.forEach((step, index) => {
    const path = `bundleVersions.${bundle.id}.steps.${step.id}`;
    if (!Number.isInteger(step.stepOrder) || step.stepOrder !== index + 1) {
      addIssue(
        issues,
        'invalid-order',
        `${path}.stepOrder`,
        'step order must be contiguous and start at 1',
      );
    }
    validateStepPolicy(step, path, issues);
  });

  validateBundleBindings(bundle, snapshot, issues);

  if (bundle.releaseStatus === 'published') {
    const scripts = new Map(snapshot.scriptVersions.map((script) => [script.id, script]));
    const packages = new Map(snapshot.runtimePackages.map((runtimePackage) => [runtimePackage.id, runtimePackage]));
    for (const step of bundle.steps) {
      const script = scripts.get(step.scriptVersionId);
      const runtimePackage = script ? packages.get(script.runtimePackageId) : undefined;
      if (
        !script ||
        script.releaseStatus !== 'published' ||
        !runtimePackage ||
        runtimePackage.validationStatus !== 'valid' ||
        !runtimePackage.executable ||
        !runtimePackage.storageObjectRef ||
        !runtimePackage.checksumSha256 ||
        !runtimePackage.entrypoint
      ) {
        addIssue(
          issues,
          'publication-gate',
          `bundleVersions.${bundle.id}.steps.${step.id}`,
          'published bundles require published script versions backed by validated executable packages',
        );
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
