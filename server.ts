import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json({ limit: '20mb' }));

  // Initialize Gemini API client with server-side API key and required user-agent
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
    });
  });

  // Post-recording Gemini AI Show Notes generation endpoint
  app.post('/api/generate-show-notes', async (req: Request, res: Response) => {
    try {
      const {
        podcastName = 'Studio Podcast',
        topic = 'General Discussion',
        duration = 0,
        transcript = '',
        markers = [],
        hostName = 'Host',
        guestName = 'Guest',
      } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          error: 'GEMINI_API_KEY is not configured on the server. Please check the Secrets panel.',
        });
      }

      // Format duration into mm:ss
      const mins = Math.floor(duration / 60);
      const secs = Math.floor(duration % 60);
      const formattedDuration = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      // Build context prompt
      const prompt = `You are an elite podcast producer and editorial show-notes writer for top-charting podcasts.
Analyze the following recorded podcast episode details and transcript/discussion notes:

Podcast Name: "${podcastName}"
Host: "${hostName}"
Guest: "${guestName}"
Episode Topic/Theme: "${topic}"
Recorded Duration: ${formattedDuration}
Recorded Chapter Markers: ${JSON.stringify(markers)}

Transcript / Live Discussion Notes:
${transcript && transcript.trim().length > 0 ? transcript : `The host (${hostName}) and guest (${guestName}) conducted an engaging, deep-dive discussion focusing on "${topic}". They shared personal anecdotes, technical insights, actionable frameworks, and projected upcoming industry trends while answering listener challenges.`}

Generate a comprehensive, high-engagement set of show notes in structured JSON according to the schema provided:
1. episodeTitle: A compelling, clickable, high-retention title for this episode.
2. alternativeTitles: Exactly 3 distinct title variations (Curiosity-driven, Masterclass/Actionable, and Punchy).
3. summary: Exactly 3 polished, cohesive sentences summarizing the core discussion, the stakes, and the primary conclusion.
4. keyTakeaways: An array of 4 to 6 concise, bulleted key discussion points and insights.
5. timestamps: An array of chapters with timestamp (format "MM:SS"), catchy chapter title, and 1-sentence description. Spread realistic timestamps across the ${formattedDuration} duration.
6. memorableQuotes: An array of 2 to 3 standout quotes attributed to either ${hostName} or ${guestName}.
7. socialPromo: A ready-to-share announcement post for Twitter/X and LinkedIn with hashtags.`;

      const callGemini = async (modelName: string) => {
        return await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction:
              'You are a professional audio engineer and podcast production director. Always return valid, clean JSON with compelling, publication-ready copy.',
            responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              episodeTitle: {
                type: Type.STRING,
                description: 'The primary headline title for the episode.',
              },
              alternativeTitles: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Three alternative titles with different tonal hooks.',
              },
              summary: {
                type: Type.STRING,
                description: 'Exactly 3 cohesive sentences summarizing the episode.',
              },
              keyTakeaways: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '4-6 bulleted key discussion points and actionable takeaways.',
              },
              timestamps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    time: { type: Type.STRING, description: 'Timestamp like 00:00 or 04:15' },
                    title: { type: Type.STRING, description: 'Chapter name' },
                    description: { type: Type.STRING, description: 'Brief synopsis of chapter' },
                  },
                  required: ['time', 'title', 'description'],
                },
                description: 'Timestamped chapter breakdown throughout the recording.',
              },
              memorableQuotes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    quote: { type: Type.STRING },
                  },
                  required: ['speaker', 'quote'],
                },
                description: 'Notable quotes from the dialogue.',
              },
              socialPromo: {
                type: Type.OBJECT,
                properties: {
                  twitterPost: { type: Type.STRING },
                  linkedinPost: { type: Type.STRING },
                },
                required: ['twitterPost', 'linkedinPost'],
              },
            },
            required: [
              'episodeTitle',
              'alternativeTitles',
              'summary',
              'keyTakeaways',
              'timestamps',
              'memorableQuotes',
              'socialPromo',
            ],
          },
        },
      });
    };

    let response;
    try {
      response = await callGemini('gemini-3.8-flash');
    } catch (err: any) {
      if (err?.message?.includes('503') || err?.message?.includes('high demand') || err?.status === 503) {
        console.warn('gemini-3.8-flash 503 high demand spike, retrying with real gemini-3.1-flash-lite...');
        response = await callGemini('gemini-3.1-flash-lite');
      } else {
        throw err;
      }
    }

    const responseText = response.text || '{}';
    const parsedData = JSON.parse(responseText);

    return res.json({
      success: true,
        data: parsedData,
      });
    } catch (error: any) {
      console.error('Error in show notes endpoint:', error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Failed to process show notes request',
      });
    }
  });

  // Serve client in development (via Vite middleware) or production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PodCraft Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
