export type VisionArtifactScope = 'all' | 'current';

export const DEFAULT_VISION_ARTIFACT_FILTERS = {
  query: '',
  type: 'all',
  scope: 'all' as VisionArtifactScope
};
