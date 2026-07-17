import { validateImage, validateVideo } from './media.js';
export function validatePrompt(text) { if (!text.trim() || Buffer.byteLength(text) > 32768)
    throw new Error('prompt output rejected'); return text; }
export function validateGeneratedMedia(kind, candidate) { return kind === 'image' ? validateImage(candidate) : validateVideo(candidate); }
//# sourceMappingURL=output.js.map