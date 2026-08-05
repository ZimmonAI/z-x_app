import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('owner storage reference persistence', () => {
  it('reuses the existing output_authorization_ref compatibility slot', async () => {
    const lifecycle = await readFile('src/worker/lifecycle.ts', 'utf8');
    expect(lifecycle).toContain('output_authorization_ref=coalesce(output_authorization_ref,$4)');
    expect(lifecycle).toContain('recordOutputAuthorization');
  });

  it('reconciliation reuses the original attempt and persisted references', async () => {
    const reconciliation = await readFile('src/worker/reconciliation.ts', 'utf8');
    expect(reconciliation).toContain('a.output_authorization_ref is not null');
    expect(reconciliation).toContain('a.safe_provider_output_ref is not null');
    expect(reconciliation).toContain('attemptId: claim.attemptId');
    expect(reconciliation).not.toContain('createOutputAuthorization(');
  });

  it('keeps the owner-storage migration history additive', async () => {
    const migrations = await readdir('migrations');
    expect(migrations).toEqual([
      '0001_execution_foundation_down.sql',
      '0001_execution_foundation_up.sql',
      '0002_video_maker_phase_engine_down.sql',
      '0002_video_maker_phase_engine_up.sql',
    ]);
  });
});
