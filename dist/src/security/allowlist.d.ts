export declare const ADAPTER_ALLOWLIST: {
    readonly 'image_prompt.prepare.v1': {
        readonly id: "image-prompt-prepare-v1";
        readonly version: "1.0.0";
    };
    readonly 'image.generate.v1': {
        readonly id: "image-generate-v1";
        readonly version: "1.0.0";
    };
    readonly 'scene_video_prompt.prepare.v1': {
        readonly id: "scene-video-prompt-prepare-v1";
        readonly version: "1.0.0";
    };
    readonly 'scene_video.generate.v1': {
        readonly id: "scene-video-generate-v1";
        readonly version: "1.0.0";
    };
};
export declare function assertAllowlistedBinding(operation: keyof typeof ADAPTER_ALLOWLIST, id: string, version: string, mode: string): void;
export declare function rejectArbitraryExecutionInput(input: {
    executable?: string;
    path?: string;
    url?: string;
    command?: string;
}): void;
