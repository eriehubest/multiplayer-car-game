import { getLeaderboardScores, saveLeaderboardScore } from "./leaderboard.ts";
import { getRoomSummaries, handleWebSocket } from "./realtime.ts";
import { corsHeaders, jsonResponse } from "./response.ts";

export function handleRequest(request: Request): Response | Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return jsonResponse({
      status: "ok",
      service: "multiplayer-car-backend",
      rooms: getRoomSummaries().length,
      time: new Date().toISOString(),
    });
  }

  if (url.pathname === "/api/rooms") {
    return jsonResponse({ rooms: getRoomSummaries() });
  }

  if (url.pathname === "/api/leaderboard") {
    return handleLeaderboardRequest(request);
  }

  if (url.pathname === "/ws") {
    return handleWebSocket(request, url);
  }

  return jsonResponse({ error: "Not found" }, { status: 404 });
}

async function handleLeaderboardRequest(request: Request) {
  if (request.method === "GET") {
    const result = await getLeaderboardScores();

    if (!result.ok) return result.response;

    return jsonResponse({ scores: result.scores, storage: "kv" });
  }

  if (request.method === "POST") {
    return saveLeaderboardScore(request);
  }

  return jsonResponse({ error: "Method not allowed" }, { status: 405 });
}
