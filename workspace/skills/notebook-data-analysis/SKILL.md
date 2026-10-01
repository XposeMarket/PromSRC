---
name: notebook-data-analysis
description: Run iterative Python data analysis (pandas, numpy, matplotlib) on CSV, Excel, JSON, or parquet data, step by step with checkpoints, and optionally produce a clean, re-runnable Jupyter notebook (.ipynb) with saved charts and a findings summary. Chooses between the local Python on the Windows host and the isolated chatgpt_sandbox. Use for exploratory data analysis, "analyze this dataset", "build me a notebook", or editing and re-running an existing .ipynb. Do not use for repeatable ETL or file conversion (data-pipeline), a single inline chart from numbers already in hand (chart-visualizer), or SQL against a database (database-query).
---

# Notebook Data Analysis

Treat analysis like a notebook session: small steps, inspect after each one, keep state, and end with something that re-runs top to bottom. Never report a number you did not see printed.

## 1. Pick the runtime (check, do not assume)

Run one probe with `workspace_run`:

```powershell
python --version; python -c "import pandas, numpy, matplotlib; print('ok', pandas.__version__)"; python -c "import nbformat, nbclient; print('nb ok')"; jupyter --version
```

Then choose:

| Situation | Route |
|---|---|
| Data is local or private, pandas imports | Local Python via `workspace_run` |
| Python exists but pandas is missing | Ask once whether to create a project venv: `python -m venv .venv-analysis` then `.venv-analysis\Scripts\python -m pip install pandas numpy matplotlib nbformat nbclient ipykernel`. Never pip install into the global interpreter without asking |
| No usable local Python, data is small and not sensitive | `chatgpt_sandbox` with the data inlined or summarized and explicit instructions to save outputs to /mnt/data |
| Data is sensitive | Local only. Do not send it to the sandbox without the user's explicit OK |

Record the route and interpreter path in `write_note` for long sessions. The Windows host uses PowerShell; write code to `.py` files rather than long `-c` one-liners to avoid quoting problems.

## 2. Set up the workspace

`analysis/<slug>/` with `data/` (copies or links, never modify originals), `steps/`, `figures/`, `cache/`, and `findings.md`.

Keep state between steps without a live kernel: each step script loads the previous checkpoint (`cache/stepN.parquet` or `.pkl`) and writes its own. If a Jupyter kernel is available and the user wants a live REPL, an `.ipynb` executed with `jupyter nbconvert --to notebook --execute --inplace` is fine too.

## 3. Load and profile first

Step 01 always prints, for each input: shape, dtypes, head(5), null counts per column, duplicate rows, unique counts for low-cardinality columns, numeric `describe()`, date range for date columns, and memory size. For big files read a sample or use `usecols` / `chunksize` before loading everything.

Write 3 to 6 lines in `findings.md` on data quality before any analysis: missing data, odd types (numbers stored as text, mixed date formats), suspicious values, and what the grain of a row is.

## 4. Iterate in small steps

For each question the user cares about:

1. Write `steps/NN-<name>.py` doing one thing: clean, join, aggregate, model, or plot.
2. Run it with `workspace_run`; read the printed output.
3. Sanity check: row counts before and after joins and filters, totals that should reconcile, groups that should sum to the whole, no silent NaN from type coercion.
4. Note the result and any caveat in `findings.md` immediately.

Charts: matplotlib with `matplotlib.use("Agg")`, saved to `figures/NN-name.png` at about 150 dpi, labelled axes with units, a title that states the finding, readable fonts, no default rainbow palettes. Use a restrained palette (one accent plus neutrals). Embed key figures in the reply with markdown image links. For a quick inline chart of final summary numbers, `chart-visualizer` or `show_ui_card` type `chart` is fine.

## 5. Notebook deliverable (when requested or when the analysis should be reusable)

1. Assemble the step scripts into a notebook with `nbformat` (one markdown cell explaining intent above each code cell): setup and imports, load, profile, cleaning, analysis sections, conclusions.
2. Use relative paths and a single config cell at the top for file paths and parameters.
3. Restart and run all: `jupyter nbconvert --to notebook --execute --inplace analysis/<slug>/<name>.ipynb` (or `nbclient` from a script). The notebook is not done until this passes with no errors.
4. If Jupyter is unavailable, deliver a clean `analysis.py` that runs top to bottom plus the `.ipynb` generated with nbformat, and say it was not executed as a notebook.
5. Editing an existing notebook: read it with `workspace_read` (it is JSON), change only the targeted cells via a small nbformat script, keep outputs of untouched cells, and re-run all to confirm.

## 6. Report

Lead with the answer in plain language, then:

- 3 to 7 findings, each with the number, its denominator or base, and the figure path.
- Data quality caveats and what was excluded.
- Methods in one short paragraph (filters, joins, definitions).
- Files: notebook or script path, figures, cleaned data.
- What would change the conclusion, and suggested next analyses.

## Guardrails

- Never overwrite source data. Write cleaned copies.
- Do not fabricate or "estimate" values that the code did not produce. If a step failed, say so.
- Correlation is not causation; say so when it matters.
- Keep secrets and personal data out of notebooks and out of the sandbox.
- Long-running jobs: use `workspace_run` start and poll instead of a single long blocking run.

## Exit criteria

- Profile step ran and data-quality notes exist.
- Every reported number appears in a printed output or saved artifact.
- Notebook deliverables pass restart and run all, or the reply states why not.
- Figures saved and embedded; files listed with paths.

Lineage: inspired by NousResearch jupyter-notebook (stateful kernel workflow, restart-and-run-all verification); rebuilt around Prometheus workspace_run checkpoints and the chatgpt_sandbox fallback.
