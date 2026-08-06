import { validateBundleVersion } from '../../src/catalog/v1/validation.js';
import { catalogFixture } from './catalog-fixture.js';

test('validates a reusable two-step draft with normalized prior-step binding', () => {
  const { snapshot, bundle } = catalogFixture();
  const result = validateBundleVersion(snapshot, bundle);

  expect(result).toEqual({ valid: true, issues: [] });
  expect(bundle.inputUsages).toHaveLength(3);
  expect(bundle.steps).toHaveLength(2);
  expect(bundle.steps[1]?.inputBindings[0]?.source).toEqual({
    kind: 'step-output',
    sourceStepId: 'step-submit',
    sourceScriptOutputUsageId: 'submit-output-job',
  });
  expect(bundle.outputUsages.find((usage) => usage.usageKey === 'generatedVideo')).toMatchObject({
    required: false,
    minItems: 0,
    maxItems: 1,
  });
});

test('rejects future-step output bindings', () => {
  const { snapshot, bundle } = catalogFixture();
  const source = bundle.steps[1]?.inputBindings[0]?.source;
  if (!source || source.kind !== 'step-output') {
    throw new Error('expected step-output fixture binding');
  }
  source.sourceStepId = 'step-poll';

  const result = validateBundleVersion(snapshot, bundle);
  expect(result.valid).toBe(false);
  expect(result.issues.some((issue) => issue.code === 'future-step-binding')).toBe(true);
});

test('rejects missing required bindings and invalid cardinality', () => {
  const { snapshot, bundle } = catalogFixture();
  const prompt = snapshot.scriptVersions[0]?.inputUsages[0];
  if (!prompt || !bundle.steps[0]) {
    throw new Error('expected prompt fixture usage');
  }
  prompt.minItems = 0;
  bundle.steps[0].inputBindings = bundle.steps[0].inputBindings.filter(
    (binding) => binding.targetScriptInputUsageId !== prompt.id,
  );

  const result = validateBundleVersion(snapshot, bundle);
  expect(result.valid).toBe(false);
  expect(result.issues.some((issue) => issue.code === 'invalid-cardinality')).toBe(true);
  expect(result.issues.some((issue) => issue.code === 'missing-binding')).toBe(true);
});

test('does not derive step control behavior from descriptive tags', () => {
  const { snapshot, bundle } = catalogFixture();
  const firstStep = bundle.steps[0];
  if (!firstStep) {
    throw new Error('expected first step');
  }
  firstStep.tags = ['FAILED', 'POLLING', 'advance-to-step-99'];

  expect(validateBundleVersion(snapshot, bundle)).toEqual({ valid: true, issues: [] });
});

test('blocks publication until real script packages are validated', () => {
  const blocked = catalogFixture({ bundleStatus: 'published' });
  const blockedResult = validateBundleVersion(blocked.snapshot, blocked.bundle);
  expect(blockedResult.valid).toBe(false);
  expect(blockedResult.issues.filter((issue) => issue.code === 'publication-gate')).toHaveLength(2);

  const ready = catalogFixture({
    bundleStatus: 'published',
    scriptStatus: 'published',
    packageValidationStatus: 'valid',
    packageExecutable: true,
  });
  expect(validateBundleVersion(ready.snapshot, ready.bundle)).toEqual({ valid: true, issues: [] });
});
