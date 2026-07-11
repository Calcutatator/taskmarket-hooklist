export function shouldStartEvaluatorReview(
  task:
    | { evaluator: string | null; evaluationWindow: number | null; mode: string }
    | null
    | undefined
): task is { evaluator: string; evaluationWindow: number; mode: string } {
  return Boolean(
    task?.evaluator && task.evaluationWindow && task.mode !== 'bounty' && task.mode !== 'benchmark'
  );
}
