# Text-to-SQL agent experiment: plan and rules

Goal: a data analytics agent on the Living Context Graph (LCG) data, as accurate as possible
(target 80%+, stretch 90%), token-efficient, Haiku 5.5 only.

## Dataset
- BIRD dev, the 3 databases LCG uses: card_games, toxicology, thrombosis_prediction (499 questions).
- LCG reference (held-out 146 q, execution accuracy): raw schema 13.0%, +5 examples 24.0%,
  learned store 36.3%, oracle 59.6%. Their split is not published; we make our own.

## Hard constraints (from the user)
- Every agent model call: claude-haiku-5-5. No other model, ever.
- No vector / embedding / semantic-model search. Keyword search only (BM25-style index),
  exposed as a code-mode search DSL: the agent writes a small script calling search and
  graph functions; only the script's printed result enters its context.

## Settings
- The question alone, always. BIRD's per-question evidence/hint is NEVER put in the prompt
  (train or test). The user's rule: real analytics users give no hints. Train evidence is used
  only offline, as source material for the learned layer of the graph (like LCG).
- Agent calls go through the stripped SDK wrapper (~45-token harness overhead), with
  strictMcpConfig, no claude.ai connectors and no title-generation call.
- The graph is traversable by the agent (progressive closure / agentic search): neighbors()
  over column, table, fk, concept and example edges.
- Every run is traced (per turn: model text, tool code, tool output, tokens, time) so wrong
  answers on train can be diagnosed. Test traces are sealed with test results.

## Anti-leakage rules (fixed before any experiment)
1. Split per database, ~70/30, grouped: questions whose gold SQL has the same skeleton
   (literals removed) or near-identical text stay on the same side. Seed fixed. Done once.
2. Test is sealed. Test questions and gold live in `data/sealed/`. Only `eval_test` reads them,
   and it prints aggregate metrics only. Per-question test results go to `data/sealed/results/`
   and are never read by me or fed back into the system.
3. The test set is run once per frozen system version, not to tune. Tuning uses train only
   (with a train-internal dev fold to check that improvements generalise).
4. The agent has no filesystem tools. It only gets custom tools: read-only SQL on the database
   copy and the context graph. Tool calls are logged and audited for any path or gold access.
5. The context graph is built from: database schema, BIRD's own column description files
   (they ship with the databases), sampled values, and TRAIN questions + evidence + gold SQL.
   Nothing from test.
6. Known caveats we cannot remove: BIRD is public, so the model may have seen it; BIRD gold
   labels have known errors, which caps reachable accuracy. We estimate the gold-error rate on
   train only.

## Frozen system for the single test run (decided on train only, 2026-11-16)
- Primary: `v4_linked` = runbook v4 + closure pack (keyword search + learned term->column links,
  values, learned concepts, 4 similar past questions) + code-mode explore tool + submit_sql.
  Learned layer built from all 353 train questions. Haiku 5.5, stripped SDK, no hints.
- Reference only (not a selection candidate): `v0_schema` (full schema dump, no learned layer).
- Decided against on train-cv: reviewer subagent (v5: -0.8 pts, +30% tokens, 2x latency);
  answer voting (two runs agree on 86% of questions; oracle of two runs only 59.5%).
- Train-cv results (353 q, leave-group-out): v1 54.7%, v4 56.9%, v5 56.1%.
- Train failure audit (v4, 152 failures): 73 gold wrong, 31 ambiguous, 48 real agent errors.
  Estimated ceiling vs original BIRD gold on train: ~79%.

## Test result (single run, 146 sealed questions, aggregate only)
- v4_linked: EX 60.3% (88/146). card_games 34/56, toxicology 31/42, thrombosis 23/48.
  ~11.0k input tokens, ~670 output tokens, 3.2 turns, 6.9 s per question. Haiku 5.5 only.
- v0_schema reference: EX 50.0% (73/146), ~18.3k input tokens.
- LCG paper (their split, held-out 146): raw schema 13.0%, learned store 36.3%, oracle 59.6%.
- Audit: 292 test traces, 737 tool calls, 0 sandbox-escape or dataset-path attempts.
- Per-question test results stay in data/sealed/ and were not read.

## Metrics
- Execution accuracy (EX): result-row multiset equal to gold, BIRD style (set of tuples).
- Schema recall: share of gold tables/columns present in the context the agent was given.
- Context precision / size: tokens of context, share of it actually used.
- Tokens and latency per question, tool calls per question.
- Failure taxonomy on train: schema-linking, value-linking, knowledge missing, SQL logic,
  output-shape, gold-label error.
