import pino from 'pino';
import { redact } from '../security/redaction.js';
export function createLogger(level = 'info') {
    return pino({
        level,
        base: { service: 'z-x-execution-runner' },
        formatters: { log: (object) => redact(object) },
    });
}
//# sourceMappingURL=logger.js.map