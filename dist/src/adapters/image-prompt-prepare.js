import { validatePrompt } from '../validation/output.js';
import { requiredScalarString } from './types.js';
export const imagePromptPrepareAdapter = {
    operation: 'image_prompt.prepare.v1',
    id: 'image-prompt-prepare-v1',
    version: '1.0.0',
    async execute({ request }) {
        const scene = requiredScalarString(request, 'scene');
        const styleValue = request.safeScalarInputs.style;
        if (styleValue !== undefined && typeof styleValue !== 'string') {
            throw new Error('style must be a string when supplied');
        }
        const style = typeof styleValue === 'string' && styleValue.trim() ? styleValue : 'cinematic';
        const resourceLineage = request.frozenInputResources
            .map((resource) => `${resource.kind}:${resource.resourceId}`)
            .join(', ');
        const prompt = resourceLineage
            ? `${style}: ${scene}. Frozen references: ${resourceLineage}.`
            : `${style}: ${scene}.`;
        return { promptText: validatePrompt(prompt) };
    },
};
//# sourceMappingURL=image-prompt-prepare.js.map