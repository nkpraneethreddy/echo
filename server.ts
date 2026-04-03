import express from "express";
import path from "path";
import { Resend } from "resend";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json());

function getGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");
  return new GoogleGenAI({ apiKey });
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: process.env.NODE_ENV || "development" });
});

// In-memory OTP store (for demo purposes)
// In production, use Firestore or Redis with TTL
const otpStore = new Map<string, { code: string; expiresAt: number }>();

// Email Client (Lazy initialization)
let resendClient: Resend | null = null;

function getResend() {
  if (resendClient) return resendClient;
  
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn("[AUTH] RESEND_API_KEY missing. OTPs will only be logged to console.");
    return null;
  }

  resendClient = new Resend(apiKey);
  return resendClient;
}

async function sendOtpEmail(email: string, otp: string) {
  const resend = getResend();
  const from = process.env.SMTP_FROM || 'Nocturnal Echo <onboarding@resend.dev>';

  if (!resend) {
    console.log("------------------------------------------");
    console.log(`[AUTH] [FALLBACK] OTP for ${email}: ${otp}`);
    console.log("------------------------------------------");
    return false;
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: email,
      subject: "Your Nocturnal Echo Verification Code",
      text: `Your verification code is: ${otp}. It will expire in 10 minutes.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; background: #0a0a0a; color: #fff; border-radius: 12px;">
          <h2 style="color: #6366f1;">Nocturnal Echo</h2>
          <p>Welcome to the nocturnal circle.</p>
          <p>Your verification code is:</p>
          <h1 style="font-size: 32px; letter-spacing: 5px; color: #6366f1;">${otp}</h1>
          <p style="font-size: 12px; opacity: 0.6;">This code will expire in 10 minutes.</p>
        </div>
      `
    });

    if (error) {
      console.error(`[AUTH] Resend error for ${email}:`, error);
      return false;
    }

    console.log(`[AUTH] OTP email sent to ${email} (ID: ${data?.id})`);
    return true;
  } catch (err) {
    console.error(`[AUTH] Failed to send OTP email to ${email}:`, err);
    return false;
  }
}

// API Routes
app.post("/api/auth/otp/send", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  otpStore.set(email, { code: otp, expiresAt });

  const sent = await sendOtpEmail(email, otp);

  if (sent) {
    res.json({ message: "OTP sent successfully to your email." });
  } else {
    res.json({ message: "OTP generated. (Check server logs if Resend is not configured)" });
  }
});

app.post("/api/auth/otp/verify", (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });

  const stored = otpStore.get(email);
  if (!stored) return res.status(400).json({ error: "No OTP requested for this email" });

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(email);
    return res.status(400).json({ error: "OTP has expired" });
  }

  if (stored.code !== otp) {
    return res.status(400).json({ error: "Invalid OTP" });
  }

  // Success - clear the OTP
  otpStore.delete(email);
  res.json({ success: true });
});

app.get("/api/ai/status", (req, res) => {
  res.json({ configured: Boolean(process.env.GEMINI_API_KEY) });
});

app.post("/api/ai/interpret", async (req, res) => {
  const { text, type, age, gender } = req.body || {};

  if (!text || (type !== "poem" && type !== "quote")) {
    return res.status(400).json({ error: "Valid text and type are required." });
  }

  const truncatedText = String(text).length > 1000 ? String(text).slice(0, 1000) + "..." : String(text);
  const prompts = {
    poem: `You are a warm, relatable poet. A user has written a private diary entry. Write a short poem (6-8 lines total) based on it that:
- Each line MUST be very short (maximum 6 to 7 words per line)
- Feels like something a real person would write - simple words, honest emotions
- Does NOT use complex metaphors or flowery language
- Sounds like a friend put their day into a few heartfelt lines
- Focus on the emotional resonance rather than the narrative.
- Be abstract and subtle. Do NOT reveal specific events, names, or the "real meaning" of the entry.
- The output should be so abstract that a stranger reading it would have NO IDEA what the journal entry was actually about, only the mood it left behind.
- Hints at the mood without being a direct summary.
- Rhymes are welcome but not forced.

User profile:
- Age: ${age || 'unknown'}
- Gender: ${gender || 'unknown'}

Diary Entry:
${truncatedText}

Output:
Return only the poem.`,
    quote: `You are writing a quote for someone to share on their social media after a personal day. Based on their diary entry, write ONE quote that:
- Sounds like a real person said it, not a motivational poster
- Is simple, short, and easy to understand
- Captures the general feeling of their day
- Be abstract and subtle. Do NOT reveal specific events, names, or the "real meaning" of the entry.
- Is 1 to 2 sentences max

User profile:
- Age: ${age || 'unknown'}
- Gender: ${gender || 'unknown'}

Diary Entry:
${truncatedText}

Output:
Return only the quote inside quotation marks. Nothing else.`
  } as const;

  try {
    const ai = getGemini();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompts[type],
      config: { temperature: 0.7, topP: 0.95 }
    });
    return res.json({ text: response.text || "" });
  } catch (err) {
    console.error("[AI] Interpretation error:", err);
    return res.status(500).json({ error: "Failed to generate interpretation." });
  }
});

app.post("/api/ai/prompt", async (req, res) => {
  const { entries } = req.body || {};
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: "entries must be an array." });
  }

  const context = entries.slice(-10).map((e: any) => e?.content || "").join("\n---\n");
  const truncatedContext = context.length > 2000 ? context.slice(0, 2000) + "..." : context;
  const prompt = `You are a thoughtful, observant journal guide. Based on these past journal entries, identify recurring themes, emotions, or life patterns. Then, write ONE short, punchy, and deeply personal writing prompt for tonight.
Rules:
- Do NOT mention specific names or events from the entries.
- Focus on the feeling or pattern.
- The prompt should be 1 sentence max.
- Avoid generic prompts.

Past Entries Context:
${truncatedContext}

Output:
Return only the prompt.`;

  try {
    const ai = getGemini();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { temperature: 0.8, topP: 0.95 }
    });
    return res.json({ text: response.text?.trim() || "" });
  } catch (err) {
    console.error("[AI] Prompt generation error:", err);
    return res.status(500).json({ error: "Failed to generate personalized prompt." });
  }
});

async function startServer() {
  const mode = process.env.NODE_ENV || "development";
  console.log(`[SERVER] Starting in ${mode} mode...`);

  if (mode !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("[SERVER] Vite middleware integrated.");
    } catch (err) {
      console.error("[SERVER] Failed to load Vite:", err);
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    console.log(`[SERVER] Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Running on http://localhost:${PORT}`);
  });
}

startServer();
