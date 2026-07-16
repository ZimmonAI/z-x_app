export const EXECUTION_STATES = ['accepted','resolving-route','waiting-capacity','queued','running','succeeded','failed','cancelled','timed-out','reconciliation-required'] as const;
export type ExecutionState = typeof EXECUTION_STATES[number];
export const TERMINAL_STATES = new Set<ExecutionState>(['succeeded','cancelled']);
const transitions: Record<ExecutionState, readonly ExecutionState[]> = {
  accepted:['resolving-route','cancelled'],
  'resolving-route':['waiting-capacity','queued','failed','cancelled','timed-out'],
  'waiting-capacity':['queued','failed','cancelled','timed-out'],
  queued:['running','cancelled','timed-out'],
  running:['succeeded','failed','cancelled','timed-out','reconciliation-required'],
  'reconciliation-required':['succeeded','failed','cancelled','timed-out'],
  failed:['queued'], 'timed-out':['queued'], succeeded:[], cancelled:[]
};
export function canTransition(from: ExecutionState, to: ExecutionState, hasManualRetryCase=false): boolean {
  if ((from==='failed'||from==='timed-out') && to==='queued') return hasManualRetryCase;
  return transitions[from].includes(to);
}
export function assertTransition(from: ExecutionState,to: ExecutionState,manual=false): void {
  if(!canTransition(from,to,manual)) throw new Error(`invalid lifecycle transition ${from} -> ${to}`);
}
