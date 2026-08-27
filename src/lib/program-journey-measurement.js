function programMetrics(journey) {
  const programKey = String(journey?.program_key || '').toLowerCase();
  const explicitDays = Number(journey?.program_days);
  const programDays = explicitDays === 2 ? 2 : 3;
  return {
    program_key: programKey,
    program_days: programDays,
    completed_steps: Number(journey?.completed_steps || 0),
    total_steps: Number(journey?.total_steps || programDays * 4),
  };
}

function completed(step) {
  return Boolean(step?.completed_at);
}

export function resolveProgramJourneyMeasurements(previousJourney, nextJourney, variables = {}) {
  if (!previousJourney || !nextJourney) return [];
  const metrics = programMetrics(nextJourney);

  if (variables.action === 'start') {
    const wasStarted = previousJourney.status === 'in_progress' || previousJourney.status === 'completed';
    if (!wasStarted && nextJourney.status === 'in_progress') {
      return [{
        eventName: 'program_journey_start',
        details: { ...metrics, reminders_enabled: nextJourney.reminders_enabled === true },
      }];
    }
    return [];
  }

  if (variables.action === 'toggle_step' && variables.completed === true) {
    const previousStep = previousJourney.schedule?.find((step) => step.step_id === variables.step_id);
    const nextStep = nextJourney.schedule?.find((step) => step.step_id === variables.step_id);
    if (!previousStep || !nextStep || completed(previousStep) || !completed(nextStep)) return [];

    const measurements = [{
      eventName: 'program_check_in',
      details: {
        ...metrics,
        day_number: Number(nextStep.day_number),
        day_period: String(nextStep.time_key || ''),
      },
    }];
    if (previousJourney.status !== 'completed' && nextJourney.status === 'completed') {
      measurements.push({ eventName: 'program_journey_complete', details: metrics });
    }
    return measurements;
  }

  if (variables.action === 'set_reminders') {
    const previousEnabled = previousJourney.reminders_enabled === true;
    const nextEnabled = nextJourney.reminders_enabled === true;
    if (previousEnabled !== nextEnabled && nextEnabled === variables.reminders_enabled) {
      return [{
        eventName: 'program_reminder_update',
        details: { ...metrics, reminders_enabled: nextEnabled },
      }];
    }
  }

  return [];
}
