export function createProgramCelebration({
  journey,
  stepId,
  completed,
  commandId,
  lastCelebratedCommandId,
}) {
  if (!completed || !commandId || commandId === lastCelebratedCommandId || !journey) return null;

  const programDays = Number(journey.program_days) === 2 ? 2 : 3;
  const totalSteps = Math.max(1, Number(journey.total_steps || programDays * 4));
  const completedSteps = Math.max(0, Number(journey.completed_steps || 0));
  const programComplete = journey.status === 'completed' || completedSteps >= totalSteps;
  const step = Array.isArray(journey.schedule)
    ? journey.schedule.find((candidate) => candidate?.step_id === stepId)
    : null;

  if (programComplete) {
    return {
      id: commandId,
      kind: 'program_complete',
      eyebrow: `${programDays}-day journey complete`,
      title: 'You did it.',
      message: `Your ${journey.program_name || 'NuVira'} program is complete. Take a moment to celebrate every check-in.`,
    };
  }

  return {
    id: commandId,
    kind: 'step_complete',
    eyebrow: `${completedSteps} of ${totalSteps} moments complete`,
    title: 'Good job!',
    message: `${step?.product_name || 'This moment'} is checked off. Continue at the pace that feels right for you.`,
  };
}
