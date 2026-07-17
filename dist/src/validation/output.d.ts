import { type MediaCandidate } from './media.js';
export declare function validatePrompt(text: string): string;
export declare function validateGeneratedMedia(kind: 'image' | 'video', candidate: MediaCandidate): MediaCandidate;
