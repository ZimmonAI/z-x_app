export interface MediaCandidate {
    mimeType: string;
    sizeBytes: number;
    width: number;
    height: number;
    durationSeconds?: number;
    checksumSha256: string;
    storageIdentity?: string;
    temporaryUrl?: string;
}
export declare function validateImage(v: MediaCandidate): MediaCandidate;
export declare function validateVideo(v: MediaCandidate): MediaCandidate;
