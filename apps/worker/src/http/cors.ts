/** Bearer-authenticated browser clients need preflight; cookies are never enabled. */
export function corsHeaders(
  request: Request,
  stage: string,
  configuredOrigins: string,
): Record<string, string> | null {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  const configured = configuredOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const local = stage === "dev" && /^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!origin.startsWith("https://")) return null;
  if (!local && !configured.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
