import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentEvaluations } from '@/db/schema';
import { AGENT_MODEL, isPostCutoff } from '@/lib/agent/models';
import type { AgentOutput } from '@/lib/agent/schema';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ScoreBadge } from '@/components/score-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { rescoreSignal } from './actions';

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export async function AgentPanel({ signalId, signalAt, latestEvalId }: { signalId: string; signalAt: Date; latestEvalId: string | null }) {
  const evals = await db.select().from(agentEvaluations).where(eq(agentEvaluations.signalId, signalId)).orderBy(desc(agentEvaluations.createdAt));
  const latest = evals.find((e) => e.id === latestEvalId) ?? null;
  const output = latest?.output as AgentOutput | null;
  const failures = evals.filter((e) => e.status === 'agent_failed');
  const countsTowardGates = isPostCutoff(signalAt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent evaluation</CardTitle>
        <CardDescription>
          {AGENT_MODEL.id}, judging only from the data as of the signal date.{' '}
          {countsTowardGates ? 'Counts toward the evaluation gates.' : `Signal predates the model's ${AGENT_MODEL.trainingCutoff} cutoff, so it is shown but not counted in the gates.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {latest && output ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <ScoreBadge score={latest.score} className="px-3 py-1 text-xl" />
              <Badge variant="secondary">{latest.conviction} conviction</Badge>
            </div>
            <p className="text-sm leading-relaxed">{output.thesis}</p>
            <List title="Bull points" items={output.bull_points} />
            <List title="Red flags" items={output.red_flags} />
            {output.insider_quality_notes ? (
              <div>
                <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">Insider quality</h3>
                <p className="text-sm">{output.insider_quality_notes}</p>
              </div>
            ) : null}
            <List title="Data gaps" items={output.data_gaps} />
            <p className="text-muted-foreground text-xs">
              {latest.model} · prompt {latest.promptVersion} · {formatDateTime(latest.createdAt)} CT · {formatNumber(latest.tokensIn)} in /{' '}
              {formatNumber(latest.tokensOut)} out tokens · {((latest.latencyMs ?? 0) / 1000).toFixed(1)}s
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {failures.length
              ? `Not evaluated: ${failures.length} attempt${failures.length === 1 ? '' : 's'} failed (${failures[0].error}).`
              : 'Not evaluated yet. The daily job picks up new signals, or evaluate it now.'}
          </p>
        )}

        <form action={rescoreSignal}>
          <input type="hidden" name="signalId" value={signalId} />
          <Button type="submit" size="sm" variant="outline">
            {latest ? 'Re-score with current prompt' : 'Evaluate now'}
          </Button>
          <span className="text-muted-foreground ml-3 text-xs">Adds a new evaluation; the old one is kept. Takes about 15 seconds.</span>
        </form>

        {evals.length > 1 || (evals.length === 1 && !latest) ? (
          <details className="text-xs">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer">Evaluation history ({evals.length})</summary>
            <ul className="mt-2 space-y-1">
              {evals.map((e) => (
                <li key={e.id} className="text-muted-foreground flex flex-wrap items-center gap-2">
                  <span>{formatDateTime(e.createdAt)} CT</span>
                  {e.status === 'ok' ? <ScoreBadge score={e.score} /> : <Badge variant="destructive">Failed</Badge>}
                  <span>
                    {e.model} · prompt {e.promptVersion}
                    {e.id === latestEvalId ? ' · shown above' : ''}
                    {e.error ? ` · ${e.error}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
