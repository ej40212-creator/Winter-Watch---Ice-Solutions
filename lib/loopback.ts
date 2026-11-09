/** Host header only. A public hostname never qualifies, even if the flag is set. */
export function isLoopbackHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}
