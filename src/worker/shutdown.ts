export class ShutdownController {
  private stopping = false;
  private readonly active = new Set<Promise<unknown>>();

  begin(): void {
    this.stopping = true;
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  track<T>(task: Promise<T>): Promise<T> {
    this.active.add(task);
    void task.finally(() => this.active.delete(task));
    return task;
  }

  get activeCount(): number {
    return this.active.size;
  }

  async drain(milliseconds = 30_000): Promise<boolean> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), milliseconds);
    });
    const result = await Promise.race([
      Promise.allSettled([...this.active]).then(() => 'done' as const),
      timeout,
    ]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return result === 'done';
  }
}
