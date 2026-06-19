import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { customAlphabet, nanoid } from "nanoid";
import { Server } from "socket.io";
import { config } from "./config.js";
import { generateCategory } from "./services/categoryService.js";
import {
  clearAnswers,
  createRoom,
  getAnswers,
  getPlayers,
  getRoomState,
  getScores,
  getUsedCategories,
  leaderboard,
  roomExists,
  saveAnswers,
  savePlayers,
  saveRoomState,
  saveScores,
  saveUsedCategories
} from "./services/roomStore.js";
import { scoreAnswers } from "./services/scoringService.js";
import type { Player, RoomState } from "./types/game.js";

const roomCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4);
const colors = ["#ff5a5f", "#2ec4b6", "#ffbf00", "#7b61ff"];
const avatars = [
  "luffy",
  "zoro",
  "nami",
  "sanji",
  "chopper",
  "robin",
  "franky",
  "brook"
];
const timers = new Map<string, NodeJS.Timeout>();

const app = express();

const isAllowedOrigin = (origin?: string) => {
  if (!origin) {
    return true;
  }

  if (config.clientOrigins.includes(origin)) {
    return true;
  }

  return /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}):\d+$/.test(origin);
};

app.use(
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin))
  })
);
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.get('/', (req, res) => {
  res.send('Category Sprint backend is running ✅');
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "https://category-sprint-frontend.vercel.app",
    methods: ["GET", "POST"]
  }
});

const publicRoomSnapshot = async (code: string) => ({
  players: await getPlayers(code),
  leaderboard: await leaderboard(code),
  state: await getRoomState(code),
  settings: {
    roundSeconds: config.roundSeconds,
    totalRounds: config.totalRounds
  }
});

const emitPlayers = async (code: string) => {
  const snapshot = await publicRoomSnapshot(code);
  io.to(code).emit("players-updated", snapshot);
};

const createUniqueRoomCode = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = roomCode();
    if (!(await roomExists(code))) {
      return code;
    }
  }

  throw new Error("Unable to create a unique room code");
};

const startRound = async (code: string) => {
  const state = await getRoomState(code);
  if (!state || state.status === "finished") {
    return;
  }

  const nextRound = state.round + 1;
  if (nextRound > config.totalRounds) {
    const finalScores = await leaderboard(code);
    const winner = finalScores[0] ?? null;
    const finishedState: RoomState = {
      ...state,
      status: "finished",
      timerEndsAt: null
    };

    await saveRoomState(finishedState);
    io.to(code).emit("game-over", { finalScores, winner, state: finishedState });
    return;
  }

  const usedCategories = await getUsedCategories(code);
  const category = await generateCategory(usedCategories);
  const timerEndsAt = Date.now() + config.roundSeconds * 1000;
  const nextState: RoomState = {
    ...state,
    round: nextRound,
    status: "round",
    category,
    timerEndsAt
  };

  await saveRoomState(nextState);
  await saveUsedCategories(code, [...usedCategories, category]);
  await clearAnswers(code, nextRound);

  io.to(code).emit("round-start", {
    category,
    round: nextRound,
    totalRounds: config.totalRounds,
    timerSeconds: config.roundSeconds,
    timerEndsAt,
    leaderboard: await leaderboard(code)
  });

  const existingTimer = timers.get(code);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  timers.set(
    code,
    setTimeout(() => {
      void revealRound(code);
    }, config.roundSeconds * 1000)
  );
};

const revealRound = async (code: string) => {
  const state = await getRoomState(code);
  if (!state || state.status !== "round") {
    return;
  }

  const [players, answers, scores] = await Promise.all([
    getPlayers(code),
    getAnswers(code, state.round),
    getScores(code)
  ]);
  const results = await scoreAnswers(state.category, players, answers);

  results.forEach((result) => {
    if (result.scored) {
      scores[result.playerId] = (scores[result.playerId] ?? 0) + 1;
    }
  });

  const revealState: RoomState = {
    ...state,
    status: "reveal",
    timerEndsAt: null
  };

  await saveScores(code, scores);
  await saveRoomState(revealState);

  io.to(code).emit("round-reveal", {
    round: state.round,
    category: state.category,
    answers: results,
    scores,
    leaderboard: await leaderboard(code),
    nextRoundStartsInMs: state.round >= config.totalRounds ? null : 3500
  });

  if (state.round >= config.totalRounds) {
    setTimeout(() => {
      void startRound(code);
    }, 2500);
    return;
  }

  setTimeout(() => {
    void startRound(code);
  }, 3500);
};

io.on("connection", (socket) => {
  socket.on("create-room", async ({ name, color, avatar }: { name?: string; color?: string; avatar?: string }, callback) => {
    try {
      const code = await createUniqueRoomCode();
      const host: Player = {
        id: nanoid(10),
        socketId: socket.id,
        name: name?.trim().slice(0, 24) || "Host",
        color: color || colors[0],
        avatar: avatar || avatars[0],
        isHost: true,
        connected: true
      };

      await createRoom(code, host);
      await socket.join(code);
      callback?.({ ok: true, code, player: host, snapshot: await publicRoomSnapshot(code) });
      await emitPlayers(code);
    } catch (error) {
      callback?.({ ok: false, error: error instanceof Error ? error.message : "Unable to create room" });
    }
  });

  socket.on(
    "join-room",
    async (
      {
        code,
        name,
        playerId,
        color,
        avatar
      }: { code?: string; name?: string; playerId?: string; color?: string; avatar?: string },
      callback
    ) => {
      const normalizedCode = code?.trim().toUpperCase() ?? "";
      const state = await getRoomState(normalizedCode);

      if (!state) {
        callback?.({ ok: false, error: "Room not found" });
        return;
      }

      const players = await getPlayers(normalizedCode);
      let player = playerId ? players.find((existing) => existing.id === playerId) : undefined;

      if (player) {
        player.socketId = socket.id;
        player.connected = true;
        player.avatar = player.avatar || avatar || avatars[players.indexOf(player) % avatars.length];
      } else {
        if (players.length >= 4) {
          callback?.({ ok: false, error: "Room is full" });
          return;
        }

        player = {
          id: nanoid(10),
          socketId: socket.id,
          name: name?.trim().slice(0, 24) || `Player ${players.length + 1}`,
          color: color || colors[players.length % colors.length],
          avatar: avatar || avatars[players.length % avatars.length],
          isHost: false,
          connected: true
        };
        players.push(player);

        const scores = await getScores(normalizedCode);
        scores[player.id] = scores[player.id] ?? 0;
        await saveScores(normalizedCode, scores);
      }

      await savePlayers(normalizedCode, players);
      await socket.join(normalizedCode);
      callback?.({ ok: true, code: normalizedCode, player, snapshot: await publicRoomSnapshot(normalizedCode) });
      await emitPlayers(normalizedCode);
      io.to(normalizedCode).emit("player-reconnected", { playerId: player.id });
    }
  );

  socket.on("start-game", async ({ code, playerId }: { code?: string; playerId?: string }, callback) => {
    const normalizedCode = code?.trim().toUpperCase() ?? "";
    const [state, players] = await Promise.all([getRoomState(normalizedCode), getPlayers(normalizedCode)]);

    if (!state) {
      callback?.({ ok: false, error: "Room not found" });
      return;
    }

    if (state.hostId !== playerId) {
      callback?.({ ok: false, error: "Only the host can start the game" });
      return;
    }

    if (players.length < 2) {
      callback?.({ ok: false, error: "At least 2 players are required" });
      return;
    }

    if (players.length > 4) {
      callback?.({ ok: false, error: "At most 4 players are allowed" });
      return;
    }

    callback?.({ ok: true });
    await startRound(normalizedCode);
  });

  socket.on(
    "submit-answer",
    async ({ code, playerId, answer }: { code?: string; playerId?: string; answer?: string }, callback) => {
      const normalizedCode = code?.trim().toUpperCase() ?? "";
      const state = await getRoomState(normalizedCode);

      if (!state || state.status !== "round" || !state.timerEndsAt || Date.now() > state.timerEndsAt) {
        callback?.({ ok: false, error: "Submissions are closed" });
        return;
      }

      if (!playerId) {
        callback?.({ ok: false, error: "Missing player id" });
        return;
      }

      const answers = await getAnswers(normalizedCode, state.round);
      answers[playerId] = answer?.trim().slice(0, 80) ?? "";
      await saveAnswers(normalizedCode, state.round, answers);
      callback?.({ ok: true });
    }
  );

  socket.on("disconnect", async () => {
    for (const socketRoom of socket.rooms) {
      if (socketRoom === socket.id) {
        continue;
      }

      const players = await getPlayers(socketRoom);
      const player = players.find((existing) => existing.socketId === socket.id);
      if (!player) {
        continue;
      }

      player.connected = false;
      await savePlayers(socketRoom, players);
      io.to(socketRoom).emit("player-disconnected", { playerId: player.id });
      await emitPlayers(socketRoom);
    }
  });
});

httpServer.listen(config.port, () => {
  console.log(`Category Sprint backend listening on port ${config.port}`);
});
