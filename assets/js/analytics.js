const allowed = new Set([
  'blackboard_page_view','extra_credit_started','submission_correct','submission_wrong',
  'one_away_triggered','note_opened','group_solved','puzzle_completed','puzzle_failed',
  'result_copied','result_shared','archive_opened'
]);
const parentChannel = 'obk:blackboard:analytics:v1';

export function track(name, details = {}) {
  if (!allowed.has(name)) return;
  const safe = Object.fromEntries(Object.entries(details).filter(([, value]) =>
    ['string','number','boolean'].includes(typeof value)
  ));
  const payload = { name, ...safe };
  window.dispatchEvent(new CustomEvent('blackboard:analytics', { detail: payload }));
  if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: name, ...safe });
  if (window.parent !== window) window.parent.postMessage({ channel: parentChannel, payload }, '*');
}
