import { Counter, Histogram, Gauge, Registry } from 'prom-client';
export declare const metricsRegistry: Registry<"text/plain; version=0.0.4; charset=utf-8">;
export declare const submissions: Counter<"outcome">;
export declare const executionDuration: Histogram<"outcome" | "operation">;
export declare const currentStates: Gauge<"state">;
