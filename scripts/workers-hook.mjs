export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { shortCircuit: true, url: new URL("./workers-stub.mjs", import.meta.url).href };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  const source = typeof result.source === "string" ? result.source : result.source ? Buffer.from(result.source).toString("utf8") : "";
  if (!source.includes("import.meta.env")) return result;
  return { ...result, source: `import.meta.env ??= {}; import.meta.env.DEV ??= true;\n${source}` };
}
