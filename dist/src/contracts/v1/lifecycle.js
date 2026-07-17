export const EXECUTION_STATES = ['accepted', 'resolving-route', 'waiting-capacity', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed-out', 'reconciliation-required'];
export const TERMINAL_STATES = new Set(['succeeded', 'cancelled']);
const transitions = {
    accepted: ['resolving-route', 'cancelled'],
    'resolving-route': ['waiting-capacity', 'queued', 'failed', 'cancelled', 'timed-out'],
    'waiting-capacity': ['queued', 'failed', 'cancelled', 'timed-out'],
    queued: ['running', 'cancelled', 'timed-out'],
    running: ['succeeded', 'failed', 'cancelled', 'timed-out', 'reconciliation-required'],
    'reconciliation-required': ['succeeded', 'failed', 'cancelled', 'timed-out'],
    failed: ['queued'], 'timed-out': ['queued'], succeeded: [], cancelled: []
};
export function canTransition(from, to, hasManualRetryCase = false) {
    if ((from === 'failed' || from === 'timed-out') && to === 'queued')
        return hasManualRetryCase;
    return transitions[from].includes(to);
}
export function assertTransition(from, to, manual = false) {
    if (!canTransition(from, to, manual))
        throw new Error(`invalid lifecycle transition ${from} -> ${to}`);
}
//# sourceMappingURL=lifecycle.js.map