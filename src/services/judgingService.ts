import { config } from "../config.js";
import { getGeminiModel } from "./geminiClient.js";

export type JudgingAnswer = {
  playerId: string;
  answer: string;
  normalizedAnswer: string;
  compactedAnswer: string;
};

type GeminiJudgment = {
  duplicateGroups?: string[][];
};

const extractJsonObject = (text: string) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return text.slice(start, end + 1);
};

const exactDuplicateGroups = (answers: JudgingAnswer[]) => {
  const groups = new Map<string, string[]>();

  answers.forEach((answer) => {
    const group = groups.get(answer.compactedAnswer) ?? [];
    group.push(answer.playerId);
    groups.set(answer.compactedAnswer, group);
  });

  return [...groups.values()].filter((group) => group.length > 1);
};

const mergeGroups = (groups: string[][]) => {
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) {
      parent.set(id, id);
      return id;
    }

    const root = find(current);
    parent.set(id, root);
    return root;
  };

  const union = (left: string, right: string) => {
    parent.set(find(right), find(left));
  };

  groups.forEach((group) => {
    group.forEach((id) => parent.set(id, parent.get(id) ?? id));
    for (let index = 1; index < group.length; index += 1) {
      union(group[0], group[index]);
    }
  });

  const merged = new Map<string, string[]>();
  parent.forEach((_value, id) => {
    const root = find(id);
    const group = merged.get(root) ?? [];
    group.push(id);
    merged.set(root, group);
  });

  return [...merged.values()].filter((group) => group.length > 1);
};

const sanitizeGroups = (groups: unknown, validIds: Set<string>) => {
  if (!Array.isArray(groups)) {
    return [];
  }

  return groups
    .map((group) => {
      if (!Array.isArray(group)) {
        return [];
      }

      return [...new Set(group.filter((id): id is string => typeof id === "string" && validIds.has(id)))];
    })
    .filter((group) => group.length > 1);
};

export async function judgeDuplicateGroups(category: string | null, answers: JudgingAnswer[]) {
  const exactGroups = exactDuplicateGroups(answers);
  const model = getGeminiModel();

  if (!config.geminiJudgingEnabled || !model || answers.length < 2) {
    return exactGroups;
  }

  try {
    const answerLines = answers
      .map((answer) => `- ${answer.playerId}: ${JSON.stringify(answer.answer)}`)
      .join("\n");
    const prompt = [
      "You judge duplicate answers for a fast party game.",
      "Group answers that are the same item or close enough in normal speech to cancel each other.",
      "Treat spelling, spacing, pluralization, abbreviations, and synonyms for the same object as duplicates.",
      "Do not group broad related ideas that are meaningfully different.",
      `Category: ${category ?? "General category"}`,
      "Answers:",
      answerLines,
      'Return strict JSON only in this format: {"duplicateGroups":[["playerId1","playerId2"]]}',
      "Only include groups with two or more player ids."
    ].join("\n");

    const result = await model.generateContent(prompt);
    const json = extractJsonObject(result.response.text());
    if (!json) {
      return exactGroups;
    }

    const parsed = JSON.parse(json) as GeminiJudgment;
    const validIds = new Set(answers.map((answer) => answer.playerId));
    const semanticGroups = sanitizeGroups(parsed.duplicateGroups, validIds);

    return mergeGroups([...exactGroups, ...semanticGroups]);
  } catch {
    return exactGroups;
  }
}
