import { z } from 'zod';

// Spec §5.2: strict JSON, validated, so a malformed answer never reaches the database as a score.
export const agentOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  conviction: z.enum(['low', 'medium', 'high']),
  thesis: z.string().trim().min(1).max(2000),
  bull_points: z.array(z.string().trim().min(1).max(500)).max(10),
  red_flags: z.array(z.string().trim().min(1).max(500)).max(10),
  insider_quality_notes: z.string().trim().max(2000),
  data_gaps: z.array(z.string().trim().min(1).max(500)).max(10),
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;

/** The same shape as a Gemini `responseSchema` (an OpenAPI subset), so the model is constrained, not just asked. */
export const geminiResponseSchema = {
  type: 'OBJECT',
  properties: {
    score: { type: 'INTEGER', description: '0-100' },
    conviction: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    thesis: { type: 'STRING', description: '2-4 sentences' },
    bull_points: { type: 'ARRAY', items: { type: 'STRING' } },
    red_flags: { type: 'ARRAY', items: { type: 'STRING' } },
    insider_quality_notes: { type: 'STRING' },
    data_gaps: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['score', 'conviction', 'thesis', 'bull_points', 'red_flags', 'insider_quality_notes', 'data_gaps'],
} as const;

/** Parses model text into a validated output; the error says what was wrong, for the retry and the failure record. */
export function parseAgentOutput(text: string): { ok: true; value: AgentOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    // Models occasionally wrap JSON in a code fence even when told not to.
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    return { ok: false, error: 'Response was not valid JSON' };
  }
  const parsed = agentOutputSchema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ') };
}
