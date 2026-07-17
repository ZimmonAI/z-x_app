export async function heartbeat(pool, attemptId, leaseToken, leaseSeconds = 60) {
    const updated = await pool.query(`update execution.execution_attempts
        set heartbeat_at=now(), lease_expires_at=now()+make_interval(secs=>$3),
            updated_at=now()
      where id=$1 and lease_token=$2 and lease_expires_at>now() and status='running'
      returning id`, [attemptId, leaseToken, leaseSeconds]);
    return Boolean(updated.rowCount);
}
function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
export async function heartbeatWithSingleRetry(pool, attemptId, leaseToken, leaseSeconds = 60) {
    try {
        if (await heartbeat(pool, attemptId, leaseToken, leaseSeconds))
            return true;
    }
    catch {
        // One bounded retry is required before local work is stopped.
    }
    await delay(2_000);
    try {
        return await heartbeat(pool, attemptId, leaseToken, leaseSeconds);
    }
    catch {
        return false;
    }
}
export function startHeartbeatLoop(input) {
    let stopped = false;
    const timer = setInterval(() => {
        if (stopped)
            return;
        void heartbeatWithSingleRetry(input.pool, input.attemptId, input.leaseToken, input.leaseSeconds).then((owned) => {
            if (!owned && !stopped) {
                stopped = true;
                clearInterval(timer);
                input.onLeaseLost();
            }
        });
    }, input.heartbeatSeconds * 1_000);
    timer.unref();
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}
//# sourceMappingURL=heartbeat.js.map