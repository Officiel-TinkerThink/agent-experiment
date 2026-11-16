// Agent variants: what context the agent starts with and its runbook.

const RUNBOOK = `You are a careful SQLite data analyst. Answer the user's question by submitting ONE SQLite query with the submit_sql tool.
Workflow:
1. Read the context you are given. Use the explore tool to check anything uncertain: column meanings, value spellings and codes (values()), date formats, joins, and similar past questions with their SQL (search(q,{kind:"example"})). Batch several lookups into one explore call.
2. Before writing SQL, decide the exact output columns: return exactly what the question asks for, in the order asked, and nothing else (no extra ids, names or helper columns unless asked).
3. Test your query with sql() inside explore and check the result makes sense (not empty, right grain, no duplicates from joins).
4. Call submit_sql with the final query. Then reply with one short sentence.
Rules: use only tables/columns that exist; match stored values exactly (case and spelling); prefer the definitions in the learned concepts and past questions when they apply.`;

function schemaText(ctx) {
  const lines = [];
  for (const t of ctx.base.tables) {
    lines.push(`TABLE ${t.name} (${t.rows} rows)${t.primary_key?.length ? ` pk: ${t.primary_key.join(",")}` : ""}`);
    for (const cname of t.columns) {
      const c = ctx.columns.get(`c:${t.name}.${cname}`.toLowerCase());
      let s = `  ${cname} ${c.type}`;
      const d = c.description || c.label;
      if (d) s += ` - ${d.slice(0, 100)}`;
      if (c.value_description) s += ` | values: ${c.value_description.replace(/\s+/g, " ").slice(0, 160)}`;
      lines.push(s);
    }
  }
  lines.push("JOINS: " + ctx.fk.map((e) => `${e.from.slice(2)} = ${e.to.slice(2)}`).join("; "));
  return lines.join("\n");
}

export function closurePack(question, ctx, opts = {}) {
  const cols = ctx.search(question, { kind: "column", k: opts.cols ?? 10 });
  const vals = ctx.values(question, { k: 8 }).filter((v) => v.score >= 1);
  const concepts = ctx.search(question, { kind: "concept", k: opts.concepts ?? 6 });
  const examples = ctx.search(question, { kind: "example", k: opts.examples ?? 3 });
  const tables = new Set(cols.map((c) => c.id.slice(2).split(".")[0]));
  for (const v of vals) tables.add(v.column.split(".")[0]);
  const lines = ["RELEVANT COLUMNS (keyword match):"];
  for (const c of cols) {
    const n = ctx.get(c.id);
    let s = `  ${c.id.slice(2)} ${n.type}`;
    if (n.description) s += ` - ${n.description.slice(0, 90)}`;
    if (n.values) s += ` | values: ${n.values.slice(0, 140)}`;
    if (n.date_format) s += ` | format ${n.date_format[0]}`;
    lines.push(s);
  }
  const tl = [...tables];
  const joinLines = new Set();
  for (let i = 0; i < tl.length; i++) for (let j = i + 1; j < tl.length; j++) for (const p of ctx.joins(tl[i], tl[j]) ?? []) joinLines.add(p);
  if (joinLines.size) lines.push("JOINS: " + [...joinLines].join("; "));
  if (vals.length) lines.push("VALUES FOUND IN DATA: " + vals.map((v) => `${v.column} = '${v.value}'`).join("; "));
  if (concepts.length) {
    lines.push("LEARNED CONCEPTS (from past verified questions):");
    for (const k of concepts) lines.push(`  - ${ctx.get(k.id).text}`);
  }
  if (examples.length) {
    lines.push("SIMILAR PAST QUESTIONS:");
    for (const x of examples) {
      const e = ctx.get(x.id);
      lines.push(`  Q: ${e.question}\n  SQL: ${e.sql.replace(/\s+/g, " ")}`);
    }
  }
  return lines.join("\n");
}

const RUNBOOK_V3 = `You are a careful SQLite data analyst. Answer the question by submitting ONE SQLite query with submit_sql.
Workflow:
1. Read the context. It was found by keyword search and by links learned from past verified questions on this database. Similar past questions show this database's conventions: which table and column hold a concept, how counts and percentages are written. Follow them unless the question clearly differs.
2. Use explore to check anything uncertain (batch lookups in one call): value spellings and codes (values()), column meanings (get), joins, more past questions (search(q,{kind:"example"})), and sample rows with sql().
3. Write down the output contract before the SQL: exactly the columns the question asks for, in the order asked. Do not add ids, names, counts, dates or helper columns that were not requested.
4. Test the query with sql() and check: not empty, right grain, no row duplication from one-to-many joins, values match stored spelling and case.
5. Call submit_sql with the final query, then reply with one short sentence.
SQL rules:
- Use INNER JOIN. Join through the entity table the question is about (e.g. a question about cards joins through cards), even if a shortcut table has the key.
- A yes/no or true/false question returns the words it asks for (e.g. CASE WHEN ... THEN 'True' ELSE 'False' END), not 0/1.
- Percentages: CAST(numerator AS REAL) * 100 / denominator. Keep full precision; round only if asked.
- Ages and durations relative to today use strftime('%Y','now') unless a reference date is given.
- Use the exact thresholds stated in descriptions and learned concepts (e.g. normal ranges).
- Do not add ORDER BY, LIMIT or DISTINCT unless the question implies them (top/most/least, distinct, unique, list each once).`;

export function closurePack3(question, ctx, opts = {}) {
  const linked = ctx.link(question, { k: opts.cols ?? 14 });
  const vals = ctx.values(question, { k: 8 }).filter((v) => v.score >= 1);
  const concepts = ctx.search(question, { kind: "concept", k: opts.concepts ?? 6 });
  const exampleIds = ctx.similar(question, linked.map((c) => c.id), opts.examples ?? 4);
  const tables = new Set(linked.map((c) => c.id.slice(2).split(".")[0]));
  for (const v of vals) tables.add(v.column.split(".")[0]);
  const lines = ["RELEVANT COLUMNS:"];
  for (const c of linked) {
    const n = ctx.get(c.id);
    let s = `  ${c.id.slice(2)} ${n.type}`;
    if (n.description) s += ` - ${n.description.slice(0, 90)}`;
    if (n.values) s += ` | values: ${n.values.slice(0, 140)}`;
    else if (n.top?.length && n.distinct <= 30) s += ` | e.g. ${n.top.slice(0, 4).map((t) => JSON.stringify(t[0])).join(", ")}`;
    if (n.date_format) s += ` | format ${n.date_format[0]}`;
    lines.push(s);
  }
  const tl = [...tables];
  const joinLines = new Set();
  for (let i = 0; i < tl.length; i++) for (let j = i + 1; j < tl.length; j++) for (const p of ctx.joins(tl[i], tl[j]) ?? []) joinLines.add(p);
  if (joinLines.size) lines.push("JOINS: " + [...joinLines].join("; "));
  if (vals.length) lines.push("VALUES FOUND IN DATA: " + vals.map((v) => `${v.column} = '${v.value}'`).join("; "));
  if (concepts.length) {
    lines.push("LEARNED CONCEPTS (from past verified questions):");
    for (const k of concepts) lines.push(`  - ${ctx.get(k.id).text}`);
  }
  if (exampleIds.length) {
    lines.push("SIMILAR PAST QUESTIONS (verified SQL):");
    for (const id of exampleIds) {
      const e = ctx.get(id);
      lines.push(`  Q: ${e.question}\n  SQL: ${e.sql.replace(/\s+/g, " ")}`);
    }
  }
  return lines.join("\n");
}

const RUNBOOK_V4 = `You are a careful SQLite data analyst. Answer the question by submitting ONE SQLite query with submit_sql.
Workflow:
1. Read the context. It was found by keyword search and by links learned from past verified questions on this database. The similar past questions are the best guide to this database's conventions: which table and column hold a concept, what a yes/no question returns, how counts, percentages and dates are written, and which columns the answer contains. When a past question has the same shape as yours, follow its SQL pattern.
2. Use explore to check anything uncertain (batch lookups in one call): value spellings and codes (values()), column meanings (get), joins, more past questions (search(q,{kind:"example"})), and sample rows with sql().
3. Write down the output contract before the SQL: exactly the columns the question asks for, in the order asked. Do not add ids, names, counts, dates or helper columns that were not requested.
4. Test the query with sql() and check: not empty, right grain, no row duplication from one-to-many joins, values match stored spelling and case.
5. Call submit_sql with the final query, then reply with one short sentence.
SQL rules:
- Percentages: CAST(numerator AS REAL) * 100 / denominator. Keep full precision; round only if asked.
- Ages and durations relative to today use strftime('%Y','now') unless a reference date is given.
- Use the exact thresholds stated in descriptions and learned concepts (e.g. normal ranges).
- Do not add ORDER BY, LIMIT or DISTINCT unless the question implies them (top/most/least, distinct, unique, list each once).`;

export const VARIANTS = {
  v4_linked: {
    learned: true,
    system: () => RUNBOOK_V4,
    prompt: (q, ctx) => `${closurePack3(q, ctx)}\n\nQUESTION: ${q}`,
  },
  v5_review: {
    learned: true,
    review: true,
    system: () => RUNBOOK_V4,
    prompt: (q, ctx) => `${closurePack3(q, ctx)}\n\nQUESTION: ${q}`,
  },
  v3_linked: {
    learned: true,
    system: () => RUNBOOK_V3,
    prompt: (q, ctx) => `${closurePack3(q, ctx)}\n\nQUESTION: ${q}`,
  },
  v0_schema: {
    learned: false,
    system: (ctx) => `${RUNBOOK}\n\nDATABASE SCHEMA:\n${schemaText(ctx)}`,
    prompt: (q) => q,
  },
  v1_closure: {
    learned: true,
    system: () => RUNBOOK,
    prompt: (q, ctx) => `${closurePack(q, ctx)}\n\nQUESTION: ${q}`,
  },
  v2_schema_closure: {
    learned: true,
    system: (ctx) => `${RUNBOOK}\n\nDATABASE SCHEMA:\n${schemaText(ctx)}`,
    prompt: (q, ctx) => `${closurePack(q, ctx, { cols: 0 })}\n\nQUESTION: ${q}`,
  },
};
