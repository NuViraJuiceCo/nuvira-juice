// Soft launch date — purchasing is disabled until this date
export const LAUNCH_DATE = new Date('2026-04-22T00:00:00');

export function isPreLaunch() {
  return false; // TESTING: temporarily disabled — re-enable before April 22nd
}

export function launchDateFormatted() {
  return LAUNCH_DATE.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}