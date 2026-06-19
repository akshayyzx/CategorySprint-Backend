import { fallbackCategories } from "./fallbackCategories.js";
import { getGeminiModel } from "./geminiClient.js";

let fallbackIndex = 0;

const nextFallbackCategory = () => {
  const category = fallbackCategories[fallbackIndex % fallbackCategories.length];
  fallbackIndex += 1;
  return category;
};

export async function generateCategory(previousCategories: string[]) {
  const model = getGeminiModel();
  if (!model) {
    return nextFallbackCategory();
  }

  try {
    const prompt = [
      "Generate one fresh, simple, family-friendly party game category.",
      "It should be answerable quickly by kids and adults.",
      "Do not include numbering, quotes, explanations, or punctuation at the end.",
      previousCategories.length > 0
        ? `Avoid repeating these categories: ${previousCategories.join("; ")}`
        : ""
    ].join(" ");

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim().replace(/^["']|["']$/g, "");
    return text || nextFallbackCategory();
  } catch {
    return nextFallbackCategory();
  }
}
