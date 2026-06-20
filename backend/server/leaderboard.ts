import { jsonResponse } from "./response.ts";

export type LeaderboardEntry = {
  id: string;
  name: string;
  time: number;
  createdAt: number;
};

let kvPromise: Promise<Deno.Kv> | null = null;

export async function saveLeaderboardScore(request: Request) {
  const body = await parseJsonBody(request);
  const score = parseLeaderboardScore(body);

  if (!score) {
    return jsonResponse({ error: "Invalid score" }, { status: 400 });
  }

  const entry: LeaderboardEntry = {
    id: `${score.time.toFixed(3).padStart(12, "0")}-${Date.now()}-${crypto.randomUUID()}`,
    name: normalizeLeaderboardName(score.name),
    time: score.time,
    createdAt: Date.now(),
  };
  const kvResult = await getKv();

  if (!kvResult.ok) {
    return kvResult.response;
  }

  await kvResult.kv.set(["leaderboard", entry.id], entry);

  const leaderboardResult = await getLeaderboardScores();

  if (!leaderboardResult.ok) return leaderboardResult.response;

  return jsonResponse({
    score: entry,
    scores: leaderboardResult.scores,
    storage: "kv",
  }, { status: 201 });
}

export async function getLeaderboardScores() {
  const kvResult = await getKv();
  const scores: LeaderboardEntry[] = [];

  if (!kvResult.ok) {
    return kvResult;
  }

  for await (const entry of kvResult.kv.list<LeaderboardEntry>({ prefix: ["leaderboard"] })) {
    scores.push(entry.value);
  }

  return {
    ok: true as const,
    scores: scores
      .filter(isLeaderboardEntry)
      .sort((a, b) => a.time - b.time)
      .slice(0, 10),
  };
}

async function getKv() {
  if (!("openKv" in Deno) || typeof Deno.openKv !== "function") {
    return {
      ok: false as const,
      response: jsonResponse({
        error: "Deno KV is not enabled. Enable --unstable-kv for the backend deployment.",
      }, { status: 503 }),
    };
  }

  try {
    kvPromise ??= Deno.openKv();

    return {
      ok: true as const,
      kv: await kvPromise,
    };
  } catch (error) {
    console.error("Deno KV unavailable", error);

    return {
      ok: false as const,
      response: jsonResponse({
        error: "Deno KV is unavailable for this deployment.",
      }, { status: 503 }),
    };
  }
}

async function parseJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseLeaderboardScore(value: unknown) {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.name !== "string" || typeof candidate.time !== "number") {
    return null;
  }

  if (!Number.isFinite(candidate.time) || candidate.time <= 0 || candidate.time > 3_600_000) {
    return null;
  }

  return {
    name: candidate.name,
    time: Math.round(candidate.time),
  };
}

function normalizeLeaderboardName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");

  return (name || "player").slice(0, 18);
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.time === "number" &&
    typeof candidate.createdAt === "number"
  );
}
