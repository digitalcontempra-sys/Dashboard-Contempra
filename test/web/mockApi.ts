import { vi } from "vitest";

export type Handler = (url: URL, init?: RequestInit) => unknown | Response | Promise<unknown | Response>;

/** Installs a fetch mock. Keys are "METHOD /path"; the handler returns a JSON body or a Response. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; url: URL; body?: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return Response.json({ error: "Not signed in" }, { status: 401 });
    const out = await handler(url, init);
    return out instanceof Response ? out : Response.json(out);
  });
  vi.stubGlobal("fetch", fn);
  return { calls };
}

export const staffUser = { id: 2, username: "ana", fullName: "Ana Lopez", accessLevel: "staff", roles: ["printer_roll"] };
export const managerUser = { id: 3, username: "mb", fullName: "Meinrad", accessLevel: "manager", roles: [] };
export const adminUser = { id: 1, username: "boss", fullName: "Jeff Baumer", accessLevel: "admin", roles: [] };
