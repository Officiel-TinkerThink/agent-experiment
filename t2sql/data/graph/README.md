# Context graph (derived data)

The graph the agent searches in the text-to-SQL experiment. Built offline; no test data is used.

- `<db>.base.json`: tables, columns and BIRD's own description files, value profiles and top values,
  date formats, foreign-key edges, and a value index. Built from the database schemas and the
  databases' own description files only (`scripts/build_graph.py`).
- `<db>.learned.all.json`: learned layer from all 353 train questions (concepts from train evidence
  with sources, past questions with gold SQL, and learned term-to-column links). Used by the
  final system (`v4_linked`).
- `<db>.learned.learn.json`: learned layer from the 282-question learn fold only. Used for
  development checks on the dev fold.

Test questions and gold labels are not in this folder. The learned layer was checked to contain
no sealed test question ids.

To rebuild: `python3 scripts/build_graph.py`, then `python3 scripts/learn.py all` and
`python3 scripts/learn.py learn`. The source databases (BIRD dev) are not in the repo; download
them and run `scripts/make_split.py` first.

Note: the learned layer and value samples are derived from BIRD dev, which is licensed
CC BY-SA 4.0. Keep that license in mind if you redistribute the graph.
