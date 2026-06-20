import { handleRequest } from "./server/http.ts";

const PORT = 8000;

if (import.meta.main) {
  console.log(`Multiplayer API listening on http://localhost:${PORT}`);
  Deno.serve({ port: PORT }, handleRequest);
}
