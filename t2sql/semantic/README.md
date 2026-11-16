# Semantic layer for the BIRD databases (card_games, toxicology, thrombosis_prediction)

Everything the agent may know about each database. No test questions, gold SQL or row data.

Per database (`<db>/`):
- `database_description/*.csv`: BIRD's own column documentation, shipped with the databases
  (table, column, meaning, value notes, date formats).
- `schema.sql`: the table and index DDL, from the database files. No rows.

Top level:
- `manifest.json`: table counts, description files and row counts per table.

The agent's full context graph is built on top of these inputs in `t2sql/data/graph/`:
- base layer: schema, descriptions, value profiles, foreign-key edges and a value index;
- learned layer: concepts, past questions and term-to-column links, built from the train split
  only (see `t2sql/data/graph/README.md`).

Source and rebuild: copy from the BIRD dev release (`dev_databases/<db>/`), then
`t2sql/scripts/build_graph.py` and `t2sql/scripts/learn.py`.

Licence: the description files and schema derive from BIRD dev (CC BY-SA 4.0). Keep that licence
if you redistribute them.

Not included on purpose: `dev.json` (its gold SQL covers the sealed test questions), and the
SQLite files themselves (about 260 MB; download from BIRD).
