# Contributing to procsi

Thanks for your interest in contributing to procsi! This document covers the basics you need to know.

## Licence

procsi is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

## Contributor Licence Agreement (CLA)

By submitting a pull request, you agree that:

1. Your contributions are licensed under the AGPL-3.0, consistent with the project licence.
2. You grant the project maintainer (Michael Ford) a perpetual, worldwide, non-exclusive, royalty-free, irrevocable licence to use, reproduce, modify, sublicence, and distribute your contributions under any licence, including proprietary licences.

This allows the maintainer to offer dual-licensing (e.g. a commercial licence for organisations that cannot use AGPL software) without needing to contact every contributor individually.

A CLA bot may be added in future to formalise this process. For now, opening a PR constitutes agreement to these terms.

## Getting Started

1. Fork the repository
2. Clone your fork and install dependencies:
   ```bash
   pnpm install
   ```
3. Create a branch for your changes
4. Make your changes
5. Run the verification suite:
   ```bash
   npm run typecheck && npm run lint && npm test
   ```
6. Open a pull request

## Code Style

- TypeScript throughout
- British English in comments and user-facing strings
- Comments should explain the "why", not the "what"
- Follow existing patterns in the codebase
- Run `npm run lint:fix` and `npm run format` before committing

## Testing

See the testing section in [CLAUDE.md](CLAUDE.md) for detailed guidance on test types and conventions. The short version:

- Unit tests live next to the source file they test
- Integration tests go in `tests/integration/`
- E2E tests go in `tests/e2e/`
- Always run `npm run typecheck && npm run lint && npm test` before submitting

## Reporting Issues

Open an issue at [github.com/mtford90/procsi/issues](https://github.com/mtford90/procsi/issues). Include steps to reproduce, expected behaviour, and actual behaviour.
