import { GoogleGenAI } from "@google/genai";

const getGeminiClient = () => {
  const apiKey =
    import.meta.env.VITE_GEMINI_API_KEY ||
    (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined);

  if (!apiKey) {
    throw new Error("Missing Gemini API key. Set VITE_GEMINI_API_KEY for the client app.");
  }

  return new GoogleGenAI({ apiKey });
};

export async function generateInterpretation(text: string, type: 'poem' | 'quote', age?: string, gender?: string) {
  const model = "gemini-2.5-flash";
  
  // Truncate text to avoid token limit issues
  const truncatedText = text.length > 1000 ? text.slice(0, 1000) + "..." : text;

  const prompts = {
    poem: `You are a warm, relatable poet. A user has written a private diary entry. Write a short poem (6–8 lines total) based on it that:

- Each line MUST be very short (maximum 6 to 7 words per line)
- Feels like something a real person would write — simple words, honest emotions
- Does NOT use complex metaphors or flowery language
- Sounds like a friend put their day into a few heartfelt lines
- Focus on the emotional resonance rather than the narrative. 
- Be abstract and subtle. Do NOT reveal specific events, names, or the "real meaning" of the entry.
- The output should be so abstract that a stranger reading it would have NO IDEA what the journal entry was actually about, only the mood it left behind.
- Hints at the mood (good, hard, confusing, exciting) without being a direct summary.
- Rhymes are welcome but not forced — natural flow matters more
- Think less like a paragraph, more like a song — short and punchy

User profile:
- Age: ${age || 'unknown'}
- Gender: ${gender || 'unknown'}

Diary Entry (treat as private — do not mention specific events or names):
${truncatedText}

Output:
Return only the poem. Keep it human, warm, and easy to read out loud.`,
    quote: `You are writing a quote for someone to share on their social media after a personal day. Based on their diary entry, write ONE quote that:

- Sounds like a real person said it, not a motivational poster
- Is simple, short, and easy to understand — no big words, no complex ideas
- Captures the general feeling of their day (could be hopeful, tired, happy, reflective, etc.)
- Be abstract and subtle. Do NOT reveal specific events, names, or the "real meaning" of the entry.
- The output should be so abstract that a stranger reading it would have NO IDEA what the journal entry was actually about, only the mood it left behind.
- Hides what actually happened but makes anyone reading it think "I've felt that too"
- Is 1 to 2 sentences max

User profile:
- Age: ${age || 'unknown'}
- Gender: ${gender || 'unknown'}

Diary Entry (treat as private — do not reveal specific events or names):
${truncatedText}

Output:
Return only the quote inside quotation marks. Nothing else.`
  };

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model,
      contents: prompts[type],
      config: {
        temperature: 0.7,
        topP: 0.95,
      }
    });
    return response.text || "The night remains silent...";
  } catch (error) {
    console.error("Gemini Error:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Could not generate an interpretation right now.");
  }
}


export async function generatePersonalizedPrompt(entries: any[]) {
  const model = "gemini-2.5-flash";
  
  // Take last 10 entries for context
  const context = entries.slice(-10).map(e => e.content).join("\n---\n");
  const truncatedContext = context.length > 2000 ? context.slice(0, 2000) + "..." : context;

  const prompt = `You are a thoughtful, observant journal guide. Based on these past journal entries, identify recurring themes, emotions, or life patterns. Then, write ONE short, punchy, and deeply personal writing prompt for tonight.

Rules:
- Do NOT mention specific names or events from the entries.
- Focus on the *feeling* or *pattern* (e.g., if they mention work stress, focus on the feeling of pressure or the need for rest).
- The prompt should be 1 sentence max.
- It should feel like you've been listening and really know them.
- Avoid generic prompts like "How was your day?".
- Make it provocative but gentle.

Past Entries Context:
${truncatedContext}

Output:
Return only the prompt. No intro, no quotes around it.`;

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.8,
        topP: 0.95,
      }
    });
    return response.text?.trim() || null;
  } catch (error) {
    console.error("Gemini Personalized Prompt Error:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Could not generate a personalized prompt.");
  }
}