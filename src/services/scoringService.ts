import type { AnswerResult, Player } from "../types/game.js";
import { judgeDuplicateGroups, type JudgingAnswer } from "./judgingService.js";

const normalizeAnswer = (answer: string) =>
  answer
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");

const compactAnswer = (answer: string) => normalizeAnswer(answer).replace(/\s/g, "");

export async function scoreAnswers(category: string | null, players: Player[], answers: Record<string, string>) {
  const submitted: Array<JudgingAnswer & { player: Player }> = players
    .map((player) => {
      const answer = answers[player.id]?.trim() ?? "";
      return {
        playerId: player.id,
        player,
        answer,
        normalizedAnswer: normalizeAnswer(answer),
        compactedAnswer: compactAnswer(answer)
      };
    })
    .filter(({ answer }) => answer.length > 0);

  const duplicateGroups = await judgeDuplicateGroups(category, submitted);
  const duplicateGroupByPlayerId = new Map<string, string>();

  duplicateGroups.forEach((group, index) => {
    const groupId = `duplicate-${index + 1}`;
    group.forEach((playerId) => duplicateGroupByPlayerId.set(playerId, groupId));
  });

  return submitted.map(({ player, answer, normalizedAnswer }) => {
    const duplicateGroup = duplicateGroupByPlayerId.get(player.id) ?? null;
    return {
      playerId: player.id,
      playerName: player.name,
      answer,
      normalizedAnswer,
      scored: !duplicateGroup,
      duplicateGroup
    };
  });
}
