import "dotenv/config";

const numberFromEnv = (key: string, fallback: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const clientOrigins = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173,http://localhost:5174")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port: numberFromEnv("PORT", 4000),
  clientOrigins,
  redisUrl: process.env.UPSTASH_REDIS_REST_URL ?? "",
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-1.5-flash",
  geminiJudgingEnabled: process.env.GEMINI_JUDGING_ENABLED !== "false",
  roomTtlSeconds: numberFromEnv("ROOM_TTL_SECONDS", 3600),
  roundSeconds: numberFromEnv("ROUND_SECONDS", 9),
  totalRounds: numberFromEnv("TOTAL_ROUNDS", 8)
};
