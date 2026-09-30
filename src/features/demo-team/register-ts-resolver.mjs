import { registerHooks } from "node:module";

/**
 * Native-Node runtime support for the demo-team seed CLI (BR-32). The app's
 * modules use extensionless relative imports (`moduleResolution: bundler`),
 * which Node's ESM resolver rejects. This hook retries an extensionless
 * relative specifier with `.ts` so the repository's own modules load under
 * plain Node type stripping — without a tsconfig change, a dependency or a
 * second copy of any module. Bare specifiers (packages) are never touched.
 */
const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error?.code === "ERR_MODULE_NOT_FOUND" &&
        RELATIVE.test(specifier) &&
        !HAS_EXTENSION.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
