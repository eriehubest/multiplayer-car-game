const PORT = 8000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type TypingResult = {
  id: number;
  wpm: number;
  accuracy: number;
  seconds: number;
  createdAt: string;
};

const results: TypingResult[] = [];

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...init.headers,
    },
  });
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return jsonResponse({
      status: "ok",
      service: "deno-backend",
      time: new Date().toISOString(),
    });
  }

  if (url.pathname === "/api/results" && request.method === "GET") {
    return jsonResponse({ results: results.toReversed() });
  }

  if (url.pathname === "/api/results" && request.method === "POST") {
    const body = await readJson(request);

    if (
      !body ||
      typeof body.wpm !== "number" ||
      typeof body.accuracy !== "number" ||
      typeof body.seconds !== "number"
    ) {
      return jsonResponse({ error: "Invalid result payload" }, { status: 400 });
    }

    const result: TypingResult = {
      id: Date.now(),
      wpm: Math.round(body.wpm),
      accuracy: Math.round(body.accuracy),
      seconds: Math.round(body.seconds * 10) / 10,
      createdAt: new Date().toISOString(),
    };

    results.push(result);

    return jsonResponse({ result }, { status: 201 });
  }

  return jsonResponse({ error: "Not found" }, { status: 404 });
}

if (import.meta.main) {
  console.log(`Deno API listening on http://localhost:${PORT}`);
  Deno.serve({ port: PORT }, handler);
}
