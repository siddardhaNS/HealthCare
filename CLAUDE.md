# Working agreement

1. Start every session by reading the build brief (`design/build-brief.pdf`) and the latest entry in `docs/progress.md`, then state the next task in one line before writing code.
2. Plan modules in `docs/plans/<module>.md`; wait for approval before building Phase 3 (SOS) and Phase 4 (calling).
3. Check current provider docs before integrating; pin exact versions.
4. Update `docs/progress.md` at the end of each session.
5. Ask before adding a paid service, changing the stack, storing new kinds of health data, or touching consent or SOS escalation rules.

## Guards that fail CI

- `pnpm check`: the product name may only appear in `packages/brand` (copy uses `{{brand}}`), and raw hex colours / font names only in `packages/tokens`.
- ESLint `no-restricted-syntax` enforces the same token rule in TS/JS.
- `packages/tokens/test/contrast.test.ts`: every theme and mode passes WCAG AA.

## Commands

See README.md.
