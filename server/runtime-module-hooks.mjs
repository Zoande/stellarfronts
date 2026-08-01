let rootAuthStoreUrl = "";

export function initialize(data) {
  rootAuthStoreUrl = data.rootAuthStoreUrl;
}

/**
 * Historical game code may import its own auth-store implementation. Redirect
 * only worktree copies to the deployed control-plane implementation, which runs
 * in runtime mode and cannot execute catalog migrations or account seeding.
 */
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (
    rootAuthStoreUrl
    && resolved.url !== rootAuthStoreUrl
    && /\/versions\/[^/]+\/server\/auth-store\.(?:ts|js)$/.test(resolved.url.replace(/\\/g, "/"))
  ) {
    return { url: rootAuthStoreUrl, shortCircuit: true };
  }
  return resolved;
}
