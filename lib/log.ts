// Structured JSON logs (spec §13): one line per event, easy to grep and ship.
export function log(msg: string, fields: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' = 'info') {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  (level === 'info' ? console.log : console.error)(line);
}
