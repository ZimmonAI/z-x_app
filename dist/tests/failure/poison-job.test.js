test('poison threshold is five claims or three internal failures', () => { const quarantine = (claims, failures) => claims >= 5 || failures >= 3; expect(quarantine(5, 0)).toBe(true); expect(quarantine(0, 3)).toBe(true); expect(quarantine(4, 2)).toBe(false); });
export {};
//# sourceMappingURL=poison-job.test.js.map