import * as path from "node:path";

/**
 * Resolve a user-supplied interceptor path to an absolute path within the
 * interceptors directory, rejecting traversal attempts and non-.ts extensions.
 */
export function resolveInterceptorPath(interceptorsDir: string, requestedPath: string): string {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new Error("Path is required.");
  }

  const absoluteInterceptorsDir = path.resolve(interceptorsDir);
  const absoluteTarget = path.resolve(absoluteInterceptorsDir, trimmed);
  const relative = path.relative(absoluteInterceptorsDir, absoluteTarget);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Interceptor path must stay inside .procsi/interceptors/.");
  }

  if (!absoluteTarget.endsWith(".ts")) {
    throw new Error("Interceptor path must end with .ts");
  }

  return absoluteTarget;
}
