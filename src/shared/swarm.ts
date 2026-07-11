import type { SwarmMode, SwarmTaskPhase } from './types';

export const SWARM_SPECIALISTS = [
  {
    label: 'Core solution',
    research: 'Map the relevant code and data flow, then identify the smallest evidence-backed answer.',
    build: 'Trace the relevant code and implement the smallest correct end-to-end solution.'
  },
  {
    label: 'Validation',
    research: 'Independently inspect tests, edge cases, and compatibility risks; report concrete evidence and contradictions.',
    build: 'Implement or update focused tests and fix concrete edge cases or compatibility regressions.'
  },
  {
    label: 'Safety & integration',
    research: 'Inspect security, permissions, failure handling, and user-visible behavior; report concrete risks and improvements.',
    build: 'Review security, permissions, failure handling, and user-visible behavior; implement concrete fixes without broad refactors.'
  }
] as const satisfies ReadonlyArray<{ label: string } & Record<SwarmMode, string>>;

export function swarmTaskLabel(phase: SwarmTaskPhase, index: number, workerCount: number = SWARM_SPECIALISTS.length): string {
  if (phase === 'worker') {
    return workerCount === SWARM_SPECIALISTS.length
      ? SWARM_SPECIALISTS[index]?.label || `Worker ${index + 1}`
      : `Worker ${index + 1}`;
  }
  return phase === 'verifier' ? 'Verifier' : 'Synthesizer';
}

export function swarmTeamSummary(workerCount: number): string {
  const parallel = Math.min(workerCount, 3);
  return `${workerCount + 2}-role team · up to ${parallel} specialist${parallel === 1 ? '' : 's'} in parallel`;
}
