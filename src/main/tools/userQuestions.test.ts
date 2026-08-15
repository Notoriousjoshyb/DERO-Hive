import assert from 'node:assert/strict';
import type { UserQuestion, UserQuestionRequest } from '@shared/types';
import { UserQuestions, formatAnswers } from './userQuestions';

const Q: UserQuestion[] = [
  { id: 'mode', question: 'Which mode?', options: [{ label: 'Fast' }, { label: 'Thorough' }] },
  { id: 'notes', question: 'Anything else?' }
];

async function main(): Promise<void> {
  // ── happy path ────────────────────────────────────────────────────────────
  {
    const svc = new UserQuestions();
    let seen: UserQuestionRequest | undefined;
    svc.on('ask', (req: UserQuestionRequest) => { seen = req; });

    const pending = svc.ask(Q, 'conv-1');
    assert.ok(seen, 'asking emits a request for the UI');
    assert.equal(seen!.conversationId, 'conv-1');
    assert.equal(seen!.questions.length, 2);

    svc.answer(seen!.requestId, [
      { id: 'mode', answers: ['Thorough'] },
      { id: 'notes', answers: ['be careful with the db'] }
    ]);
    const answers = await pending;
    assert.deepEqual(answers.map((a) => a.answers), [['Thorough'], ['be careful with the db']]);
  }

  // ── no UI attached ────────────────────────────────────────────────────────
  // Headless, or the window went away: nobody can ever answer, so the call must
  // resolve as cancelled rather than parking the tool forever.
  {
    const svc = new UserQuestions();
    const answers = await svc.ask(Q, 'conv-1');
    assert.ok(answers.every((a) => a.cancelled), 'unanswerable questions resolve cancelled');
    assert.equal(answers.length, 2, 'one answer per question, even when cancelled');
  }

  // ── abort cancels what is parked ──────────────────────────────────────────
  {
    const svc = new UserQuestions();
    svc.on('ask', () => { /* a UI is listening but the user never answers */ });
    const pending = svc.ask(Q, 'conv-doomed');

    // A different conversation aborting must not touch this one.
    svc.cancelForConversation('conv-other');
    const settledEarly = await Promise.race([pending, Promise.resolve('still-parked' as const)]);
    assert.equal(settledEarly, 'still-parked', 'another conversation aborting leaves this parked');

    svc.cancelForConversation('conv-doomed');
    const answers = await pending;
    assert.ok(answers.every((a) => a.cancelled), 'aborting the owning conversation cancels the question');
  }

  // ── partial and unknown answers ───────────────────────────────────────────
  {
    const svc = new UserQuestions();
    let req: UserQuestionRequest | undefined;
    svc.on('ask', (r: UserQuestionRequest) => { req = r; });
    const pending = svc.ask(Q, 'conv-1');

    // Answers only the first question, and includes one for a question that was
    // never asked — the model must not be handed a reply it did not ask for.
    svc.answer(req!.requestId, [
      { id: 'mode', answers: ['Fast'] },
      { id: 'not-a-question', answers: ['injected'] }
    ]);
    const answers = await pending;
    assert.equal(answers.length, 2, 'result is shaped by the questions, not by the reply');
    assert.deepEqual(answers.map((a) => a.id), ['mode', 'notes'], 'answers stay in asked order');
    assert.deepEqual(answers[0].answers, ['Fast']);
    assert.equal(answers[1].cancelled, true, 'an unanswered question is marked cancelled');
    assert.ok(!answers.some((a) => a.answers.includes('injected')), 'unknown ids are dropped');
  }

  // ── late / duplicate replies are inert ────────────────────────────────────
  {
    const svc = new UserQuestions();
    let req: UserQuestionRequest | undefined;
    svc.on('ask', (r: UserQuestionRequest) => { req = r; });
    const pending = svc.ask(Q, 'conv-1');
    svc.answer(req!.requestId, [{ id: 'mode', answers: ['Fast'] }]);
    await pending;
    svc.answer(req!.requestId, [{ id: 'mode', answers: ['Thorough'] }]); // must not throw
    svc.answer('never-issued', [{ id: 'mode', answers: ['x'] }]);        // must not throw
  }

  // ── formatting for the model ──────────────────────────────────────────────
  const formatted = formatAnswers(Q, [
    { id: 'mode', answers: ['Fast', 'Thorough'] },
    { id: 'notes', answers: [] }
  ]);
  assert.ok(formatted.includes('mode: Fast, Thorough'), 'multi-select answers are joined');
  assert.ok(formatted.includes('notes: (no answer)'), 'an empty answer is stated, not omitted');

  const allCancelled = formatAnswers(Q, Q.map((q) => ({ id: q.id, answers: [], cancelled: true })));
  assert.ok(/cancelled/i.test(allCancelled), 'a fully cancelled ask says so');
  assert.ok(/do not retry/i.test(allCancelled), 'and tells the model not to loop on it');

  console.log('userQuestions.test.ts — all assertions passed');
}

void main();
