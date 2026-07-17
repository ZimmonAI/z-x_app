export declare class ShutdownController {
    private stopping;
    private readonly active;
    begin(): void;
    get isStopping(): boolean;
    track<T>(task: Promise<T>): Promise<T>;
    get activeCount(): number;
    drain(milliseconds?: number): Promise<boolean>;
    drain(tasks: ReadonlySet<Promise<unknown>>, milliseconds?: number): Promise<boolean>;
}
