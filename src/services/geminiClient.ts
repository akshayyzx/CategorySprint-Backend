import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";

export const hasGeminiKey = () =>
  Boolean(config.geminiApiKey) && config.geminiApiKey !== "your-gemini-api-key-here";

export function getGeminiModel() {
  if (!hasGeminiKey()) {
    return null;
  }

  const ai = new GoogleGenerativeAI(config.geminiApiKey);
  return ai.getGenerativeModel({ model: config.geminiModel });
}
