// Workflow tests import the compiled step bundle straight into Node, which
// leaves our workspace packages (@repo/*, TypeScript source) to Node's own
// loader. Node strips the types but cannot resolve their extensionless
// relative imports, so try "<specifier>.ts" for those. Next.js builds bundle
// these packages (transpilePackages), so this is only needed here.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const fromWorkspaceSource = context.parentURL?.includes('/packages/') && !context.parentURL.includes('/node_modules/');
      if (!fromWorkspaceSource || !specifier.startsWith('.') || /\.[cm]?[jt]s$/.test(specifier)) throw err;
      if (code === 'ERR_MODULE_NOT_FOUND') return nextResolve(`${specifier}.ts`, context);
      if (code === 'ERR_UNSUPPORTED_DIR_IMPORT') return nextResolve(`${specifier}/index.ts`, context);
      throw err;
    }
  },
});
