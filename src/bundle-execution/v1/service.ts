import type {
  BundleExecutionViewV1,
  TemporaryArtifactDescriptorV1,
} from '../../contracts/bundle-owner/v1/execution.js';

export interface BundleExecutionSubmitResult {
  code: 200 | 202;
  execution: BundleExecutionViewV1;
}

export interface BundleArtifactRead {
  descriptor: TemporaryArtifactDescriptorV1;
  bytes: Buffer;
}

export interface BundleOwnerExecutionService {
  submit(ownerApp: string, input: unknown): Promise<BundleExecutionSubmitResult>;
  get(ownerApp: string, executionId: string): Promise<BundleExecutionViewV1 | null>;
  readArtifact(
    ownerApp: string,
    executionId: string,
    artifactRef: string,
  ): Promise<BundleArtifactRead | null>;
}

export class UnavailableBundleOwnerExecutionService implements BundleOwnerExecutionService {
  private unavailable(): never {
    throw Object.assign(new Error('ZX_BUNDLE_RUNTIME_UNAVAILABLE'), { statusCode: 503 });
  }

  async submit(): Promise<BundleExecutionSubmitResult> {
    return this.unavailable();
  }

  async get(): Promise<BundleExecutionViewV1 | null> {
    return this.unavailable();
  }

  async readArtifact(): Promise<BundleArtifactRead | null> {
    return this.unavailable();
  }
}
