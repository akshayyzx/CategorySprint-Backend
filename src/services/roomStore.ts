import { Redis } from "@upstash/redis";
import type { LeaderboardEntry, Player, RoomState } from "../types/game.js";
import { config } from "../config.js";

const memoryStore = new Map<string, string>();

const redis =
  config.redisUrl && config.redisToken
    ? new Redis({ url: config.redisUrl, token: config.redisToken })
    : null;

const key = (code: string, suffix: string) => `room:${code}:${suffix}`;

async function getJson<T>(storeKey: string): Promise<T | null> {
  if (redis) {
    return redis.get<T>(storeKey);
  }

  const value = memoryStore.get(storeKey);
  return value ? (JSON.parse(value) as T) : null;
}

async function setJson<T>(storeKey: string, value: T) {
  if (redis) {
    await redis.set(storeKey, value, { ex: config.roomTtlSeconds });
    return;
  }

  memoryStore.set(storeKey, JSON.stringify(value));
}

async function deleteKey(storeKey: string) {
  if (redis) {
    await redis.del(storeKey);
    return;
  }

  memoryStore.delete(storeKey);
}

export async function roomExists(code: string) {
  return Boolean(await getJson<RoomState>(key(code, "state")));
}

export async function createRoom(code: string, host: Player) {
  const state: RoomState = {
    code,
    round: 0,
    status: "lobby",
    category: null,
    timerEndsAt: null,
    hostId: host.id
  };

  await setJson(key(code, "state"), state);
  await setJson(key(code, "players"), [host]);
  await setJson(key(code, "scores"), { [host.id]: 0 });

  return state;
}

export async function getRoomState(code: string) {
  return getJson<RoomState>(key(code, "state"));
}

export async function saveRoomState(state: RoomState) {
  await setJson(key(state.code, "state"), state);
}

export async function getPlayers(code: string) {
  return (await getJson<Player[]>(key(code, "players"))) ?? [];
}

export async function savePlayers(code: string, players: Player[]) {
  await setJson(key(code, "players"), players);
}

export async function getScores(code: string) {
  return (await getJson<Record<string, number>>(key(code, "scores"))) ?? {};
}

export async function saveScores(code: string, scores: Record<string, number>) {
  await setJson(key(code, "scores"), scores);
}

export async function getAnswers(code: string, round: number) {
  return (await getJson<Record<string, string>>(key(code, `answers:${round}`))) ?? {};
}

export async function saveAnswers(code: string, round: number, answers: Record<string, string>) {
  await setJson(key(code, `answers:${round}`), answers);
}

export async function clearAnswers(code: string, round: number) {
  await deleteKey(key(code, `answers:${round}`));
}

export async function getUsedCategories(code: string) {
  return (await getJson<string[]>(key(code, "categories"))) ?? [];
}

export async function saveUsedCategories(code: string, categories: string[]) {
  await setJson(key(code, "categories"), categories);
}

export async function leaderboard(code: string): Promise<LeaderboardEntry[]> {
  const [players, scores] = await Promise.all([getPlayers(code), getScores(code)]);

  return players
    .map((player) => ({
      playerId: player.id,
      name: player.name,
      color: player.color,
      avatar: player.avatar,
      score: scores[player.id] ?? 0,
      connected: player.connected
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}
