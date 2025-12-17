# Claude Code Guidelines

## Code Style

- Keep comments to a minimum - code should be self-documenting
- Prefer concise, readable implementations over verbose ones

## When Making Changes

1. **Reduce complexity** - Simplify lengthy or convoluted code while preserving functionality
2. **Remove dead code** - Delete unused functions, variables, conditions, and imports
3. **Use lib helpers** - Always use existing helper functions from `src/lib/` (e.g., `getElement`, `createElement`, `getErrorMessage`)
4. **Leverage the build system** - Structure code for tree shaking and dead code elimination
5. **Optimize algorithms** - Consider performance improvements, especially for database queries (avoid N+1 patterns)
6. **Verify assumptions** - Research external APIs and browser behaviors to confirm implementation correctness
