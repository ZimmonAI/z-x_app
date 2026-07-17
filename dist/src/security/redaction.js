const SECRET_KEY = /(authorization|cookie|token|secret|password|otp|credential|signedurl|profilepath|databaseurl)/i;
const SECRET_VALUE = new RegExp([
    String.raw `bearer\s+[a-z0-9._~+/-]+=*`,
    String.raw `eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+`,
    String.raw `-----BEGIN [A-Z ]*PRIVATE KEY-----`,
    String.raw `postgres(?:ql)?://[^\s]+`,
    String.raw `mongodb(?:\+srv)?://[^\s]+`,
].join('|'), 'i');
export const REDACTED = '[REDACTED]';
export function redact(value, seen = new WeakSet()) {
    if (typeof value === 'string')
        return SECRET_VALUE.test(value) ? REDACTED : value;
    if (value === null || typeof value !== 'object')
        return value;
    if (seen.has(value))
        return '[CIRCULAR]';
    seen.add(value);
    if (Array.isArray(value))
        return value.map((item) => redact(item, seen));
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        output[key] = SECRET_KEY.test(key) ? REDACTED : redact(item, seen);
    }
    return output;
}
//# sourceMappingURL=redaction.js.map