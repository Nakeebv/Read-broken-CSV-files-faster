# Faster exact drop-in for csv-reader 1.0.0

`solve.js` exports `run(input)`, returning exactly the `{columns, rows, errors}`
value that make.fun's csv-reader 1.0.0 returns. It scans the input once with
`charCodeAt` and cuts fields with `slice()`, avoiding the reference's per-character
string concatenation.

`main.ts` is the entry the harness runs: it reads `/input/cases.json`, answers every
case with `run`, and writes `/output/answers.json`. V8 incremental marking is
disabled as in the house driver.
