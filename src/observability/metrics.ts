import { Counter,Histogram,Gauge,Registry } from 'prom-client';
export const metricsRegistry=new Registry();
export const submissions=new Counter({name:'zx_submissions_total',help:'Accepted execution submissions',labelNames:['outcome'],registers:[metricsRegistry]});
export const executionDuration=new Histogram({name:'zx_execution_duration_seconds',help:'Execution duration',labelNames:['operation','outcome'],registers:[metricsRegistry]});
export const currentStates=new Gauge({name:'zx_execution_states',help:'Current execution states',labelNames:['state'],registers:[metricsRegistry]});
