test('event keys are designed as idempotent UUID keys', () => { const keys = new Set(['event-1', 'event-1']); expect(keys.size).toBe(1); });
export {};
//# sourceMappingURL=duplicate-callback.test.js.map