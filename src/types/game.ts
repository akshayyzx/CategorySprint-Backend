export type RoomStatus = "lobby" | "round" | "reveal" | "finished";

export type Player = {
  id: string;
  socketId: string;
  name: string;
  color: string;
  avatar: string;
  isHost: boolean;
  connected: boolean;
};

export type RoomState = {
  code: string;
  round: number;
  status: RoomStatus;
  category: string | null;
  timerEndsAt: number | null;
  hostId: string;
};

export type AnswerResult = {
  playerId: string;
  playerName: string;
  answer: string;
  normalizedAnswer: string;
  scored: boolean;
  duplicateGroup: string | null;
};

export type LeaderboardEntry = {
  playerId: string;
  name: string;
  color: string;
  avatar: string;
  score: number;
  connected: boolean;
};
