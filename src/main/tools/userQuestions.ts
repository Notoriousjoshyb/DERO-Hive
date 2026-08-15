import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { UserQuestion, UserQuestionAnswer, UserQuestionRequest } from '@shared/types';

/**
 * The user-questions seam: the provider-neutral vocabulary a tool uses when it
 * needs a human answer before the agent can continue.
 *
 * Adapted from the DeepSeek Harness user-questions seam (MIT) — see
 * HARNESS_INTEGRATION_PLAN.md §2.1. The property worth preserving is that the
 * answer shape does not depend on how a UI chose to render the question: a
 * surface that shows rich option cards and one that shows a plain list both
 * reply with the same option labels, so the caller reads identical fields.
 */
export class UserQuestions extends EventEmitter {
  private pending = new Map<string, {
    resolve: (answers: UserQuestionAnswer[]) => void;
    conversationId?: string;
    questions: UserQuestion[];
  }>();

  /**
   * Ask, and park until a UI answers. Never rejects: an abandoned question
   * resolves as cancelled so a parked tool call cannot wedge the turn.
   */
  ask(questions: UserQuestion[], conversationId?: string): Promise<UserQuestionAnswer[]> {
    const requestId = randomUUID();
    const request: UserQuestionRequest = { requestId, conversationId, questions };
    return new Promise<UserQuestionAnswer[]>((resolve) => {
      this.pending.set(requestId, { resolve, conversationId, questions });
      // No listener (headless, or a window that has gone away) means nobody can
      // ever answer — resolve immediately rather than hanging the tool call.
      if (this.listenerCount('ask') === 0) {
        this.settle(requestId, cancelledAnswers(questions));
        return;
      }
      this.emit('ask', request);
    });
  }

  /** Deliver a UI's answers. Unknown ids are ignored (a late or duplicate reply). */
  answer(requestId: string, answers: UserQuestionAnswer[]): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    // Only answers to questions actually asked, in the order they were asked,
    // so the model cannot be handed a reply to something it did not ask.
    const byId = new Map(answers.map((a) => [a.id, a]));
    this.settle(requestId, entry.questions.map((q) => byId.get(q.id) ?? { id: q.id, answers: [], cancelled: true }));
  }

  /** Abandon everything parked for a conversation — used when its turn aborts. */
  cancelForConversation(conversationId: string): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.conversationId !== conversationId) continue;
      this.settle(requestId, cancelledAnswers(entry.questions));
      this.emit('cancel', requestId);
    }
  }

  private settle(requestId: string, answers: UserQuestionAnswer[]): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    entry.resolve(answers);
  }
}

function cancelledAnswers(questions: UserQuestion[]): UserQuestionAnswer[] {
  return questions.map((q) => ({ id: q.id, answers: [], cancelled: true }));
}

/** Process-wide instance — the builtin tool and the IPC layer share it. */
export const userQuestions = new UserQuestions();

/** Render answers into the text the model reads back as the tool result. */
export function formatAnswers(questions: UserQuestion[], answers: UserQuestionAnswer[]): string {
  if (answers.every((a) => a.cancelled)) {
    return 'The user did not answer (the turn was cancelled). Do not retry the question; stop and wait for direction.';
  }
  const byId = new Map(answers.map((a) => [a.id, a]));
  return questions.map((q) => {
    const a = byId.get(q.id);
    if (!a || a.cancelled || a.answers.length === 0) return `${q.id}: (no answer)`;
    return `${q.id}: ${a.answers.join(', ')}`;
  }).join('\n');
}
