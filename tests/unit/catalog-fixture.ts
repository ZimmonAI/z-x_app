import type {
  BundleVersion,
  CatalogSnapshot,
  PackageValidationStatus,
  ReleaseStatus,
} from '../../src/catalog/v1/types.js';

const version = { major: 1, minor: 0, patch: 0 } as const;

export function catalogFixture(options: {
  bundleStatus?: ReleaseStatus;
  scriptStatus?: ReleaseStatus;
  packageValidationStatus?: PackageValidationStatus;
  packageExecutable?: boolean;
} = {}): { snapshot: CatalogSnapshot; bundle: BundleVersion } {
  const bundleStatus = options.bundleStatus ?? 'draft';
  const scriptStatus = options.scriptStatus ?? 'draft';
  const packageValidationStatus = options.packageValidationStatus ?? 'pending';
  const packageExecutable = options.packageExecutable ?? false;

  const manifestDefinitions = [
    ['manifest-prompt', 'prompt'],
    ['manifest-beginning', 'beginning-image'],
    ['manifest-ending', 'ending-image'],
    ['manifest-job', 'job-reference'],
    ['manifest-report', 'generation-report'],
    ['manifest-video', 'generated-video'],
  ].map(([id, manifestKey]) => ({
    id: id ?? '',
    manifestKey: manifestKey ?? '',
    displayName: manifestKey ?? '',
    description: manifestKey ?? '',
  }));

  const manifestVersions = manifestDefinitions.map((definition) => ({
    id: `${definition.id}-v1`,
    manifestDefinitionId: definition.id,
    version,
    valueKind: definition.manifestKey.includes('image')
      ? 'image-resource'
      : definition.manifestKey.includes('video')
        ? 'video-resource'
        : 'text',
    releaseStatus: 'published' as const,
  }));

  const runtimePackages = [
    {
      id: 'package-submit',
      storageObjectRef: packageExecutable ? 'zs://package/submit' : null,
      checksumSha256: packageExecutable ? 'a'.repeat(64) : null,
      entrypoint: packageExecutable ? 'submit.mjs' : null,
      executable: packageExecutable,
      validationStatus: packageValidationStatus,
    },
    {
      id: 'package-poll',
      storageObjectRef: packageExecutable ? 'zs://package/poll' : null,
      checksumSha256: packageExecutable ? 'b'.repeat(64) : null,
      entrypoint: packageExecutable ? 'poll.mjs' : null,
      executable: packageExecutable,
      validationStatus: packageValidationStatus,
    },
  ];

  const scriptDefinitions = [
    { id: 'script-submit', scriptKey: 'submit', displayName: 'Submit', description: 'Submit' },
    { id: 'script-poll', scriptKey: 'poll', displayName: 'Poll', description: 'Poll' },
  ];

  const scriptVersions = [
    {
      id: 'script-submit-v1',
      scriptDefinitionId: 'script-submit',
      version,
      runtimePackageId: 'package-submit',
      runtimeFrameworkKey: 'test-runtime',
      releaseStatus: scriptStatus,
      inputUsages: [
        {
          id: 'submit-input-prompt',
          manifestVersionId: 'manifest-prompt-v1',
          usageKey: 'prompt',
          required: true,
          minItems: 1,
          maxItems: 1,
          sortOrder: 1,
        },
        {
          id: 'submit-input-beginning',
          manifestVersionId: 'manifest-beginning-v1',
          usageKey: 'beginningFrame',
          required: true,
          minItems: 1,
          maxItems: 1,
          sortOrder: 2,
        },
        {
          id: 'submit-input-ending',
          manifestVersionId: 'manifest-ending-v1',
          usageKey: 'endingFrame',
          required: true,
          minItems: 1,
          maxItems: 1,
          sortOrder: 3,
        },
      ],
      outputUsages: [
        {
          id: 'submit-output-job',
          manifestVersionId: 'manifest-job-v1',
          usageKey: 'jobReference',
          required: true,
          minItems: 1,
          maxItems: 1,
          sortOrder: 1,
        },
      ],
    },
    {
      id: 'script-poll-v1',
      scriptDefinitionId: 'script-poll',
      version,
      runtimePackageId: 'package-poll',
      runtimeFrameworkKey: 'test-runtime',
      releaseStatus: scriptStatus,
      inputUsages: [
        {
          id: 'poll-input-job',
          manifestVersionId: 'manifest-job-v1',
          usageKey: 'jobReference',
          required: true,
          minItems: 1,
          maxItems: 1,
          sortOrder: 1,
        },
      ],
      outputUsages: [
        {
          id: 'poll-output-report',
          manifestVersionId: 'manifest-report-v1',
          usageKey: 'generationReport',
          required: true,
          minItems: 1,
          maxItems: 1,
          sortOrder: 1,
        },
        {
          id: 'poll-output-video',
          manifestVersionId: 'manifest-video-v1',
          usageKey: 'generatedVideo',
          required: false,
          minItems: 0,
          maxItems: 1,
          sortOrder: 2,
        },
      ],
    },
  ];

  const bundle: BundleVersion = {
    id: 'bundle-v1',
    bundleDefinitionId: 'bundle-definition',
    version,
    releaseStatus: bundleStatus,
    inputUsages: [
      {
        id: 'bundle-input-prompt',
        manifestVersionId: 'manifest-prompt-v1',
        usageKey: 'prompt',
        required: true,
        minItems: 1,
        maxItems: 1,
        sortOrder: 1,
      },
      {
        id: 'bundle-input-beginning',
        manifestVersionId: 'manifest-beginning-v1',
        usageKey: 'beginningFrame',
        required: true,
        minItems: 1,
        maxItems: 1,
        sortOrder: 2,
      },
      {
        id: 'bundle-input-ending',
        manifestVersionId: 'manifest-ending-v1',
        usageKey: 'endingFrame',
        required: true,
        minItems: 1,
        maxItems: 1,
        sortOrder: 3,
      },
    ],
    outputUsages: [
      {
        id: 'bundle-output-report',
        manifestVersionId: 'manifest-report-v1',
        usageKey: 'generationReport',
        required: true,
        minItems: 1,
        maxItems: 1,
        sortOrder: 1,
      },
      {
        id: 'bundle-output-video',
        manifestVersionId: 'manifest-video-v1',
        usageKey: 'generatedVideo',
        required: false,
        minItems: 0,
        maxItems: 1,
        sortOrder: 2,
      },
    ],
    steps: [
      {
        id: 'step-submit',
        stepKey: 'submit',
        displayName: 'Submit',
        stepOrder: 1,
        scriptVersionId: 'script-submit-v1',
        tags: ['descriptive-only'],
        policy: {
          maxAttempts: 2,
          nextAttemptIntervalSeconds: 5,
          maxScriptRuntimeSeconds: 60,
          leaseSeconds: 90,
        },
        inputBindings: [
          {
            id: 'binding-submit-prompt',
            targetScriptInputUsageId: 'submit-input-prompt',
            bindingOrder: 1,
            source: { kind: 'bundle-input', bundleInputUsageId: 'bundle-input-prompt' },
          },
          {
            id: 'binding-submit-beginning',
            targetScriptInputUsageId: 'submit-input-beginning',
            bindingOrder: 2,
            source: { kind: 'bundle-input', bundleInputUsageId: 'bundle-input-beginning' },
          },
          {
            id: 'binding-submit-ending',
            targetScriptInputUsageId: 'submit-input-ending',
            bindingOrder: 3,
            source: { kind: 'bundle-input', bundleInputUsageId: 'bundle-input-ending' },
          },
        ],
      },
      {
        id: 'step-poll',
        stepKey: 'poll',
        displayName: 'Poll',
        stepOrder: 2,
        scriptVersionId: 'script-poll-v1',
        tags: [],
        policy: {
          maxAttempts: 20,
          nextAttemptIntervalSeconds: 30,
          maxScriptRuntimeSeconds: 60,
          leaseSeconds: 90,
        },
        inputBindings: [
          {
            id: 'binding-poll-job',
            targetScriptInputUsageId: 'poll-input-job',
            bindingOrder: 1,
            source: {
              kind: 'step-output',
              sourceStepId: 'step-submit',
              sourceScriptOutputUsageId: 'submit-output-job',
            },
          },
        ],
      },
    ],
    finalOutputBindings: [
      {
        id: 'final-report',
        bundleOutputUsageId: 'bundle-output-report',
        sourceStepId: 'step-poll',
        sourceScriptOutputUsageId: 'poll-output-report',
      },
      {
        id: 'final-video',
        bundleOutputUsageId: 'bundle-output-video',
        sourceStepId: 'step-poll',
        sourceScriptOutputUsageId: 'poll-output-video',
      },
    ],
  };

  const snapshot: CatalogSnapshot = {
    manifestDefinitions,
    manifestVersions,
    scriptDefinitions,
    runtimePackages,
    scriptVersions,
    bundleDefinitions: [
      {
        id: 'bundle-definition',
        bundleKey: 'test-two-step-bundle',
        displayName: 'Test bundle',
        description: 'Test bundle',
      },
    ],
    bundleVersions: [bundle],
  };

  return { snapshot, bundle };
}
