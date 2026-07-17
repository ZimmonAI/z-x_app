export class ShutdownController {
    stopping = false;
    active = new Set();
    begin() {
        this.stopping = true;
    }
    get isStopping() {
        return this.stopping;
    }
    track(task) {
        this.active.add(task);
        void task.finally(() => this.active.delete(task));
        return task;
    }
    get activeCount() {
        return this.active.size;
    }
    async drain(tasksOrMilliseconds = this.active, maybeMilliseconds = 30_000) {
        const tasks = typeof tasksOrMilliseconds === 'number' ? this.active : tasksOrMilliseconds;
        const milliseconds = typeof tasksOrMilliseconds === 'number' ? tasksOrMilliseconds : maybeMilliseconds;
        let timeoutHandle;
        const timeout = new Promise((resolve) => {
            timeoutHandle = setTimeout(() => resolve('timeout'), milliseconds);
        });
        const result = await Promise.race([
            Promise.allSettled([...tasks]).then(() => 'done'),
            timeout,
        ]);
        if (timeoutHandle)
            clearTimeout(timeoutHandle);
        return result === 'done';
    }
}
//# sourceMappingURL=shutdown.js.map