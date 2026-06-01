# Project conventions

## Git workflow
- **Commit and push directly to `main` by default** whenever asked to commit/push
  (e.g. "gacp" = git add, commit, push). Do **not** create a feature branch
  unless the user explicitly asks for one.
- End commit messages with the `Co-Authored-By: Claude ...` trailer.
- Do not commit one-off/throwaway scripts under `telo-web/db/scripts/*.mjs`
  (debug/ops helpers) unless explicitly asked.
