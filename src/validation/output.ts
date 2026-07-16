import { validateImage,validateVideo,type MediaCandidate } from './media.js';
export function validatePrompt(text:string):string{if(!text.trim()||Buffer.byteLength(text)>32768)throw new Error('prompt output rejected');return text;}
export function validateGeneratedMedia(kind:'image'|'video',candidate:MediaCandidate):MediaCandidate{return kind==='image'?validateImage(candidate):validateVideo(candidate);}
