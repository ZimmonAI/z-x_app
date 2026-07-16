const SECRET_KEY=/(authorization|cookie|token|secret|password|otp|credential|signedurl|profilepath|databaseurl)/i;
const SECRET_VALUE=/(bearer\s+[a-z0-9._~+\/-]+=*|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s]+|mongodb(?:\+srv)?:\/\/[^\s]+)/i;
export const REDACTED='[REDACTED]';
export function redact(value:unknown,seen=new WeakSet<object>()):unknown {
 if(typeof value==='string') return SECRET_VALUE.test(value)?REDACTED:value;
 if(value===null||typeof value!=='object') return value;
 if(seen.has(value)) return '[CIRCULAR]'; seen.add(value);
 if(Array.isArray(value)) return value.map(v=>redact(v,seen));
 const out:Record<string,unknown>={}; for(const [k,v] of Object.entries(value)) out[k]=SECRET_KEY.test(k)?REDACTED:redact(v,seen); return out;
}
