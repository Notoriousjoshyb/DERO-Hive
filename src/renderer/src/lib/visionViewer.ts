// Keep modal keyboard policy small and independently testable so the Vision
// gallery does not accidentally dismiss while users navigate its controls.
export function shouldCloseVisionArtifactViewer(key: string): boolean {
  return key === 'Escape';
}
