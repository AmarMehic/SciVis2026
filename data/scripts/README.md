Data prep scripts live here (fetch DYAMOND GEOS files, slice, precompute streamlines/paths/particles). Use the `sci-vis` conda env from `environment.yml`.

- Keep raw downloads outside the repo; script inputs should point to local paths or buckets.
- Emit downsampled JSON fixtures into `../samples/` that match the schemas in `docs/components.md`.
- Document expected CLI args at the top of each script; prefer small defaults so teammates can sanity-check without full datasets.
