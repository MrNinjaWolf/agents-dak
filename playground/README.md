# Playground

Small Python, JavaScript and Go modules with bugs planted in them, a miniature version of the "70 bugs in 116k lines" test. Their own tests pass, so the bugs are hidden.

Run the hunt and score it:

```text
/devkit:bug-hunt playground
```

```bash
python3 scripts/score.py reports/bug-hunt/result.json
```

To compare against a single agent, ask Claude (in a fresh session) to "check playground/ for bugs and write them to reports/single/result.json as a JSON list of {file, line, title}", then score that file the same way.

Reset after a `fix: true` run with `git checkout -- playground`.
