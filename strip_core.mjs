// Removes injected context from one Anthropic Messages request body.
// Used by strip_daemon.mjs. Pure function: no I/O, no network.
// Options (defaults shown):
//   reminders: true   drop text blocks that start with <system-reminder>
//   env: true         drop text blocks that start with "# Environment"
//   system: false     drop the top-level system prompt
export function stripBody(raw, opts = {}) {
  const stripReminders = opts.reminders ?? true;
  const stripEnv = opts.env ?? true;
  const stripSystem = opts.system ?? false;

  const kindOf = (text) => {
    if (stripReminders && text.startsWith("<system-reminder>")) return "reminder";
    if (stripEnv && text.startsWith("# Environment")) return "environment";
    return null;
  };

  const b = JSON.parse(raw);
  const report = { removed: [], removedChars: 0, systemRemoved: false };
  const messages = [];
  for (const m of b.messages ?? []) {
    if (typeof m.content === "string") {
      const kind = kindOf(m.content);
      if (kind) {
        report.removed.push(kind);
        report.removedChars += m.content.length;
      } else {
        messages.push(m);
      }
      continue;
    }
    const kept = [];
    for (const blk of m.content) {
      const kind = blk.type === "text" ? kindOf(blk.text) : null;
      if (kind) {
        report.removed.push(kind);
        report.removedChars += blk.text.length;
        continue;
      }
      kept.push(blk);
    }
    // Drop a message whose blocks were all removed, so the API never gets an empty content list.
    if (kept.length > 0) messages.push({ ...m, content: kept });
  }
  b.messages = messages;
  if (stripSystem && b.system !== undefined) {
    delete b.system;
    report.systemRemoved = true;
  }
  return { body: JSON.stringify(b), report };
}
