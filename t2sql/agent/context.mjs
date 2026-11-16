// Context engine: loads the context graph of one database and serves keyword (BM25) search,
// graph lookups and value linking. No embeddings.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const STOP = new Set("a an the of in on at to for by with from and or is are was were be been what which who whom whose how many much list show give find tell me all any each every that this these those there their its it as than then do does did not no please among between per".split(" "));

export function tokenize(text) {
  const out = [];
  const s = String(text ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  for (let t of s.split(/[^a-z0-9]+/)) {
    if (!t || STOP.has(t)) continue;
    if (t.length > 4 && t.endsWith("ies")) t = t.slice(0, -3) + "y";
    else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
    out.push(t);
  }
  return out;
}

class BM25 {
  constructor(docs) {
    this.docs = docs;
    this.tf = docs.map((d) => {
      const m = new Map();
      for (const t of d.tokens) m.set(t, (m.get(t) ?? 0) + 1);
      return m;
    });
    this.df = new Map();
    for (const m of this.tf) for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avg = docs.reduce((a, d) => a + d.tokens.length, 0) / Math.max(1, docs.length);
  }
  search(query, k = 8) {
    const qt = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const scored = [];
    this.tf.forEach((m, i) => {
      let s = 0;
      const len = this.docs[i].tokens.length;
      for (const t of qt) {
        const f = m.get(t);
        if (!f) continue;
        const df = this.df.get(t);
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (len / this.avg)));
      }
      if (s > 0) scored.push([s, i]);
    });
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, k).map(([s, i]) => ({ score: Math.round(s * 100) / 100, doc: this.docs[i] }));
  }
}

function brief(text, n = 160) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// The base layer (schema, value index, column/table search) is identical for every question of a
// database, so it is built once and shared; the learned layer is built per Context.
const baseCache = new Map();
const learnedCache = new Map();

function loadBase(db) {
  if (baseCache.has(db)) return baseCache.get(db);
  const base = JSON.parse(readFileSync(join(ROOT, `data/graph/${db}.base.json`), "utf8"));
  const colDocs = base.columns.map((c) => ({
    kind: "column", id: c.id,
    tokens: tokenize([c.table, c.name, c.name, c.label, c.description, c.value_description,
      (c.top ?? []).map((v) => v[0]).join(" ")].join(" ")),
  }));
  const tableDocs = base.tables.map((t) => ({ kind: "table", id: t.id, tokens: tokenize([t.name, t.name, t.columns.join(" ")].join(" ")) }));
  const valueIndex = new Map();
  for (const [col, vals] of Object.entries(base.values)) {
    for (const v of vals) {
      for (const t of new Set(tokenize(v))) {
        let arr = valueIndex.get(t);
        if (!arr) valueIndex.set(t, (arr = []));
        if (arr.length < 400) arr.push([col, v]);
      }
    }
  }
  const out = { base, colIdx: new BM25(colDocs), tableIdx: new BM25(tableDocs), valueIndex };
  baseCache.set(db, out);
  return out;
}

function loadLearned(db, fold) {
  const key = `${db}.${fold}`;
  if (!learnedCache.has(key)) learnedCache.set(key, JSON.parse(readFileSync(join(ROOT, `data/graph/${db}.learned.${fold}.json`), "utf8")));
  return learnedCache.get(key);
}

export class Context {
  // exclude: question ids whose own knowledge must be hidden (leave-group-out evaluation on train).
  constructor(db, fold, opts = {}) {
    this.db = db;
    const B = loadBase(db);
    const base = B.base;
    const learned = fold ? loadLearned(db, fold) : { concepts: [], examples: [] };
    const exclude = opts.exclude ?? new Set();
    this.base = base;
    this.tables = new Map(base.tables.map((t) => [t.name.toLowerCase(), t]));
    this.columns = new Map(base.columns.map((c) => [c.id.toLowerCase(), c]));
    this.examples = learned.examples.filter((x) => !exclude.has(x.qid));
    this.concepts = learned.concepts
      .map((k) => {
        const sources = (k.sources ?? []).filter((s) => !exclude.has(s));
        return { ...k, sources, support: sources.length };
      })
      .filter((k) => k.support > 0 || !k.sources);
    this.fk = base.edges.filter((e) => e.type === "fk");
    this.idx = {
      column: B.colIdx,
      table: B.tableIdx,
      concept: new BM25(this.concepts.map((k) => ({ kind: "concept", id: k.id, tokens: tokenize(k.text) }))),
      example: new BM25(this.examples.map((x) => ({ kind: "example", id: x.id, tokens: tokenize(x.question + " " + x.evidence) }))),
    };
    this.valueIndex = B.valueIndex;
    // Learned term -> column association from past questions: which columns the gold SQL used
    // when a question contained a term. Keyword statistics only, no embeddings.
    this.termCount = new Map();
    this.assoc = new Map();
    for (const x of this.examples) {
      for (const t of new Set(tokenize(x.question))) {
        this.termCount.set(t, (this.termCount.get(t) ?? 0) + 1);
        if (!this.assoc.has(t)) this.assoc.set(t, new Map());
        const m = this.assoc.get(t);
        for (const r of x.refs) m.set(r.toLowerCase(), (m.get(r.toLowerCase()) ?? 0) + 1);
      }
    }
    // Graph adjacency: column<->table, column<->column (fk), concept/example -> columns, and reverse.
    this.adj = new Map();
    const link = (a, b, rel, back) => {
      const la = a.toLowerCase(), lb = b.toLowerCase();
      if (!this.adj.has(la)) this.adj.set(la, []);
      if (!this.adj.has(lb)) this.adj.set(lb, []);
      this.adj.get(la).push([rel, b]);
      this.adj.get(lb).push([back, a]);
    };
    for (const c of base.columns) link(c.id, `t:${c.table}`, "in_table", "has_column");
    for (const e of this.fk) link(e.from, e.to, "joins", "joins");
    for (const k of this.concepts) for (const r of k.refs) link(k.id, r, "about", "concept");
    for (const x of this.examples) for (const r of x.refs) link(x.id, r, "uses", "used_by");
  }

  // ---- functions exposed to the agent's code (keep outputs compact) ----
  search(q, opts = {}) {
    const kinds = opts.kind ? [opts.kind] : ["column", "concept", "example"];
    const k = opts.k ?? 6;
    const out = [];
    for (const kind of kinds) {
      for (const hit of this.idx[kind]?.search(q, k) ?? []) out.push({ kind, id: hit.doc.id, score: hit.score, brief: this.brief(hit.doc.id) });
    }
    return out;
  }

  brief(id) {
    if (id.startsWith("c:")) {
      const c = this.columns.get(id.toLowerCase());
      return c ? `${c.table}.${c.name} (${c.type}) ${brief(c.description || c.label, 90)}` : id;
    }
    if (id.startsWith("t:")) return id.slice(2);
    if (id.startsWith("k:")) return brief(this.concepts.find((k) => k.id === id)?.text, 200);
    if (id.startsWith("x:")) return brief(this.examples.find((x) => x.id === id)?.question, 160);
    return id;
  }

  get(id) {
    const key = String(id);
    if (key.startsWith("c:")) {
      const c = this.columns.get(key.toLowerCase());
      if (!c) return null;
      const o = { id: c.id, type: c.type, label: c.label, description: c.description,
        values: c.value_description ? brief(c.value_description, 600) : undefined,
        distinct: c.distinct, null_frac: c.null_frac, storage: c.storage, top: c.top };
      if (c.min !== undefined) { o.min = c.min; o.max = c.max; }
      if (c.date_format) o.date_format = c.date_format;
      o.fk = this.fk.filter((e) => e.from.toLowerCase() === key.toLowerCase() || e.to.toLowerCase() === key.toLowerCase()).map((e) => `${e.from} = ${e.to}`);
      return o;
    }
    if (key.startsWith("k:")) {
      const k = this.concepts.find((x) => x.id === key);
      return k ? { id: k.id, text: k.text, columns: k.refs, support: k.support } : null;
    }
    if (key.startsWith("x:")) {
      const x = this.examples.find((e) => e.id === key);
      return x ? { id: x.id, question: x.question, evidence: x.evidence, sql: x.sql } : null;
    }
    const t = this.tables.get(key.replace(/^t:/, "").toLowerCase());
    return t ? this.table(t.name) : null;
  }

  table(name) {
    const t = this.tables.get(String(name).replace(/^t:/, "").toLowerCase());
    if (!t) return null;
    return {
      table: t.name, rows: t.rows, primary_key: t.primary_key,
      columns: t.columns.map((c) => {
        const col = this.columns.get(`c:${t.name}.${c}`.toLowerCase());
        return `${c} ${col?.type ?? ""}${col?.description ? " - " + brief(col.description, 70) : ""}`;
      }),
      joins: this.fk.filter((e) => e.from.startsWith(`c:${t.name}.`) || e.to.startsWith(`c:${t.name}.`)).map((e) => `${e.from.slice(2)} = ${e.to.slice(2)}`),
    };
  }

  joins(a, b) {
    // Shortest join path between two tables over foreign keys (undirected BFS).
    const ta = String(a).replace(/^t:/, ""), tb = String(b).replace(/^t:/, "");
    const adj = new Map();
    for (const e of this.fk) {
      const x = e.from.slice(2).split(".")[0], y = e.to.slice(2).split(".")[0];
      const cond = `${e.from.slice(2)} = ${e.to.slice(2)}`;
      for (const [p, q] of [[x, y], [y, x]]) {
        if (!adj.has(p.toLowerCase())) adj.set(p.toLowerCase(), []);
        adj.get(p.toLowerCase()).push([q, cond]);
      }
    }
    const start = ta.toLowerCase(), goal = tb.toLowerCase();
    const prev = new Map([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === goal) break;
      for (const [nxt, cond] of adj.get(cur) ?? []) {
        if (!prev.has(nxt.toLowerCase())) { prev.set(nxt.toLowerCase(), [cur, cond]); queue.push(nxt.toLowerCase()); }
      }
    }
    if (!prev.has(goal)) return null;
    const path = [];
    for (let cur = goal; prev.get(cur); cur = prev.get(cur)[0]) path.unshift(prev.get(cur)[1]);
    return path;
  }

  link(q, opts = {}) {
    // Rank columns for a question: BM25 over column docs + learned term->column association.
    const k = opts.k ?? 10;
    const score = new Map();
    for (const hit of this.idx.column.search(q, 40)) score.set(hit.doc.id.toLowerCase(), hit.score);
    const nEx = Math.max(1, this.examples.length);
    for (const t of new Set(tokenize(q))) {
      const tc = this.termCount.get(t);
      if (!tc || tc < 2) continue;
      const idf = Math.log(1 + nEx / tc);
      for (const [col, n] of this.assoc.get(t)) {
        score.set(col, (score.get(col) ?? 0) + (opts.assocWeight ?? 1.5) * idf * (n / (tc + 1)));
      }
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)
      .map(([id, s]) => ({ id: this.columns.get(id)?.id ?? id, score: Math.round(s * 100) / 100 }))
      .filter((c) => this.columns.has(c.id.toLowerCase()));
  }

  similar(q, linkedIds = [], k = 3) {
    // Past questions ranked by text match plus overlap with the columns linked to this question.
    const linked = new Set(linkedIds.map((i) => i.toLowerCase()));
    const score = new Map();
    for (const hit of this.idx.example.search(q, 30)) score.set(hit.doc.id, hit.score);
    for (const x of this.examples) {
      const overlap = x.refs.filter((r) => linked.has(r.toLowerCase())).length;
      if (overlap) score.set(x.id, (score.get(x.id) ?? 0) + 0.6 * overlap);
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
  }

  neighbors(id, opts = {}) {
    // Linked nodes of id, grouped by relation; rel filters to one relation.
    const k = opts.k ?? 12;
    const out = {};
    for (const [rel, other] of this.adj.get(String(id).toLowerCase()) ?? []) {
      if (opts.rel && rel !== opts.rel) continue;
      out[rel] ??= [];
      if (out[rel].length < k) out[rel].push({ id: other, brief: this.brief(other) });
    }
    return out;
  }

  expand(ids, opts = {}) {
    // Progressive closure from seed column/table ids: connecting join paths, concepts about the
    // seeds, and past questions whose SQL used the most seed columns.
    const seeds = ids.map((i) => String(i));
    const tables = new Set();
    for (const s of seeds) {
      if (s.startsWith("c:")) tables.add(s.slice(2).split(".")[0]);
      else tables.add(s.replace(/^t:/, ""));
    }
    const tl = [...tables];
    const joinSet = new Set();
    for (let i = 0; i < tl.length; i++) for (let j = i + 1; j < tl.length; j++) for (const p of this.joins(tl[i], tl[j]) ?? []) joinSet.add(p);
    const conceptScore = new Map(), exampleScore = new Map();
    for (const s of seeds) {
      for (const [rel, other] of this.adj.get(s.toLowerCase()) ?? []) {
        if (rel === "concept") conceptScore.set(other, (conceptScore.get(other) ?? 0) + 1);
        if (rel === "used_by") exampleScore.set(other, (exampleScore.get(other) ?? 0) + 1);
      }
    }
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([i]) => i);
    return {
      tables: tl,
      joins: [...joinSet],
      concepts: top(conceptScore, opts.concepts ?? 6).map((i) => this.get(i).text),
      examples: top(exampleScore, opts.examples ?? 2).map((i) => { const e = this.get(i); return { q: e.question, sql: e.sql.replace(/\s+/g, " ") }; }),
    };
  }

  values(q, opts = {}) {
    // Link words of q to stored values. Exact (case-insensitive) phrase matches rank first.
    const k = opts.k ?? 8;
    const qt = tokenize(q);
    const ql = String(q).toLowerCase();
    const score = new Map();
    for (const t of new Set(qt)) {
      const hits = this.valueIndex.get(t) ?? [];
      const w = 1 / Math.log(2 + hits.length);
      for (const [col, v] of hits) {
        if (opts.column && col.toLowerCase() !== String(opts.column).replace(/^c:/, "").toLowerCase()) continue;
        const key = col + "\u0000" + v;
        score.set(key, (score.get(key) ?? 0) + w);
      }
    }
    const out = [];
    for (const [key, s] of score) {
      const [col, v] = key.split("\u0000");
      const vt = tokenize(v);
      const covered = vt.filter((t) => qt.includes(t)).length / Math.max(1, vt.length);
      const exact = v.length > 1 && ql.includes(v.toLowerCase()) ? 2 : 0;
      out.push({ column: col, value: v, score: Math.round((s * covered + exact) * 100) / 100 });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, k);
  }
}
