import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/require-user';
import { AGENT_LIMITS_KEY, AGENT_MODEL, agentLimitsSchema } from '@/lib/agent/models';
import { CLUSTER_RULE_KEY, CLUSTER_RULE_VERSION, clusterRuleSchema } from '@/lib/clusters/rule';
import { DISPLAY_KEY, displaySchema } from '@/lib/display';
import { FLAGS_KEY, getFlags } from '@/lib/flags';
import { COSTS_KEY, costsSchema } from '@/lib/market/costs';
import { NOTIFICATIONS_KEY, notificationsSchema } from '@/lib/notify/settings';
import { telegramConfigured } from '@/lib/notify/telegram';
import { BASELINE_VERSION, BASELINE_WEIGHTS_KEY, baselineWeightsSchema } from '@/lib/scoring/baseline';
import { HOLDOUT_KEY, holdoutSchema } from '@/lib/research/holdout';
import { getSetting, listVersions } from '@/lib/settings';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { SettingsForm } from '@/components/settings-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  agentLimitsAction,
  baselineWeightsAction,
  clusterRuleAction,
  costsAction,
  displayAction,
  flagsAction,
  holdoutAction,
  notificationsAction,
} from './actions';

function Num({ name, label, value, hint, step = 1, min = 0, max }: { name: string; label: string; value: number; hint?: string; step?: number; min?: number; max?: number }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <Input type="number" name={name} defaultValue={value} step={step} min={min} max={max} required className="font-mono" />
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </label>
  );
}

function Check({ name, label, checked, hint }: { name: string; label: string; checked: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="accent-primary mt-1 size-4" />
      <span>
        {label}
        {hint ? <span className="text-muted-foreground block text-xs">{hint}</span> : null}
      </span>
    </label>
  );
}

async function History({ settingKey }: { settingKey: string }) {
  const versions = await listVersions(db, settingKey, 5);
  if (!versions.length) return <p className="text-muted-foreground text-xs">Defaults, never changed.</p>;
  return (
    <details className="text-xs">
      <summary className="text-muted-foreground cursor-pointer select-none">
        Revision {versions[0].version} · saved {formatDateTime(versions[0].createdAt)} CT · history
      </summary>
      <ul className="mt-2 space-y-1">
        {versions.map((v) => (
          <li key={v.version} className="font-mono">
            <span className="text-muted-foreground">r{v.version} {formatDateTime(v.createdAt)}</span> {JSON.stringify(v.value)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Section({ title, description, children }: { title: string; description: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

const grid = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';

export default async function SettingsPage() {
  await requireUser();
  const [rule, weights, costs, display, limits, flags] = await Promise.all([
    getSetting(db, CLUSTER_RULE_KEY, clusterRuleSchema),
    getSetting(db, BASELINE_WEIGHTS_KEY, baselineWeightsSchema),
    getSetting(db, COSTS_KEY, costsSchema),
    getSetting(db, DISPLAY_KEY, displaySchema),
    getSetting(db, AGENT_LIMITS_KEY, agentLimitsSchema),
    getFlags(db),
  ]);
  const notify = await getSetting(db, NOTIFICATIONS_KEY, notificationsSchema);
  const holdout = await getSetting(db, HOLDOUT_KEY, holdoutSchema);
  const telegram = telegramConfigured();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Every saved change is numbered and kept. Signals keep the rule and score they were created with; nothing is rewritten unless you ask."
      />

      <div className="space-y-6">
        <Section
          title="Cluster rule"
          description={`What counts as a cluster of insider buying (spec §4.1). Detection logic version ${CLUSTER_RULE_VERSION}. Preview shows how many historical signals a rule would produce without saving it.`}
        >
          <SettingsForm action={clusterRuleAction} secondaryLabel="Preview impact">
            <div className={grid}>
              <Num name="windowDays" label="Window (days)" value={rule.windowDays} />
              <Num name="minInsiders" label="Minimum insiders" value={rule.minInsiders} min={1} />
              <Num name="minTotalValue" label="Minimum total ($)" value={rule.minTotalValue} step={1000} />
              <Num name="minPerInsiderValue" label="Minimum per insider ($)" value={rule.minPerInsiderValue} step={1000} />
              <Num name="minPrice" label="Minimum share price ($)" value={rule.minPrice} step={0.01} />
              <Num name="minMarketCap" label="Minimum market cap ($)" value={rule.minMarketCap} step={1_000_000} hint="Inactive until a market-cap source is wired." />
            </div>
            <Check name="excludeTenPctOnly" label="Ignore buyers who are only 10% owners" checked={rule.excludeTenPctOnly} />
          </SettingsForm>
          <History settingKey={CLUSTER_RULE_KEY} />
        </Section>

        <Section
          title="Baseline score weights"
          description={`Points each component can add to the 0-100 baseline (formula version ${BASELINE_VERSION}). Components without data are re-weighted.`}
        >
          <SettingsForm action={baselineWeightsAction} secondaryLabel="Re-score all signals">
            <div className={grid}>
              <Num name="insiders" label="Number of insiders" value={weights.insiders} />
              <Num name="valueVsMarketCap" label="Size vs market cap" value={weights.valueVsMarketCap} />
              <Num name="seniority" label="Seniority" value={weights.seniority} />
              <Num name="holdingsIncrease" label="Position increase" value={weights.holdingsIncrease} />
              <Num name="priceContext" label="Price context" value={weights.priceContext} />
              <Num name="sellPenaltyMax" label="Maximum sell penalty" value={weights.sellPenaltyMax} />
            </div>
            <p className="text-muted-foreground text-xs">
              &quot;Re-score all signals&quot; applies the <em>saved</em> weights to every existing signal. Save first, then re-score.
            </p>
          </SettingsForm>
          <History settingKey={BASELINE_WEIGHTS_KEY} />
        </Section>

        <Section title="Costs and benchmark" description="Net returns subtract a round-trip cost; thinly traded names cost more. The benchmark is what pages compare against unless a toggle says otherwise.">
          <SettingsForm action={costsAction}>
            <div className={grid}>
              <Num name="roundTripPct" label="Round-trip cost (%)" value={costs.roundTripPct} step={0.01} />
              <Num name="illiquidRoundTripPct" label="Thinly traded cost (%)" value={costs.illiquidRoundTripPct} step={0.01} />
              <Num name="illiquidDollarVolume" label="Thin below ($/day)" value={costs.illiquidDollarVolume} step={100_000} hint="Average daily dollar volume." />
            </div>
          </SettingsForm>
          <History settingKey={COSTS_KEY} />
          <SettingsForm action={displayAction}>
            <label className="flex max-w-xs flex-col gap-1 text-sm">
              <span>Default benchmark</span>
              <span className="text-muted-foreground text-xs">Used by Performance and the signals list. The dashboard stays on SPY.</span>
              <select
                name="defaultBenchmark"
                defaultValue={display.defaultBenchmark}
                className="border-input bg-background h-8 rounded-lg border px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="SPY">SPY (S&amp;P 500)</option>
                <option value="IWM">IWM (Russell 2000)</option>
              </select>
            </label>
          </SettingsForm>
          <History settingKey={DISPLAY_KEY} />
        </Section>

        <Section title="Agent" description={`${AGENT_MODEL.id}. The daily cap limits scheduled runs; the monthly token budget also blocks manual re-scores. Spend is on the System page.`}>
          <SettingsForm action={agentLimitsAction}>
            <div className={grid}>
              <Num name="dailyCap" label="Daily evaluation cap" value={limits.dailyCap} />
              <Num name="monthlyTokenBudget" label="Monthly token budget" value={limits.monthlyTokenBudget} step={1_000_000} />
              <Num name="inputUsdPerMTok" label="Input $ per million tokens" value={limits.inputUsdPerMTok} step={0.01} hint="For the spend estimate only." />
              <Num name="outputUsdPerMTok" label="Output $ per million tokens" value={limits.outputUsdPerMTok} step={0.01} />
            </div>
          </SettingsForm>
          <History settingKey={AGENT_LIMITS_KEY} />
          <SettingsForm action={flagsAction}>
            <div className="space-y-3">
              <Check name="agent_scoring" label="Run agent evaluations" checked={flags.agent_scoring} />
              <Check name="early_watch_clusters" label="Show early-watch clusters (one buyer from qualifying)" checked={flags.early_watch_clusters} />
            </div>
          </SettingsForm>
          <History settingKey={FLAGS_KEY} />
        </Section>

        <Section
          title="Holdout"
          description="Signals from this day on are the untouched test window. Their returns stay out of every aggregate, gate, list, export and MCP tool until you reveal them, so tuning the rule or scores can't peek at them. Freeze the design first, then reveal once."
        >
          <SettingsForm action={holdoutAction}>
            <label className="flex max-w-xs flex-col gap-1 text-sm">
              <span>Held out from (Chicago date)</span>
              <Input type="date" name="from" defaultValue={holdout.from} required className="font-mono" />
            </label>
            <Check
              name="reveal"
              label="Reveal the holdout"
              checked={holdout.reveal}
              hint="Lifts the freeze. Each save is recorded in the history below, so revealing is an auditable event."
            />
          </SettingsForm>
          <History settingKey={HOLDOUT_KEY} />
        </Section>

        <Section
          title="Notifications"
          description={
            telegram
              ? 'Telegram alerts are configured. Signal alerts fire once per signal, within 3 days of it forming, when either score reaches the threshold.'
              : 'Telegram is not configured. Create a bot with @BotFather, put TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local, and restart the app.'
          }
        >
          <SettingsForm action={notificationsAction} secondaryLabel="Send test message">
            <div className="space-y-3">
              <Check name="notifications" label="Notifications on" checked={flags.notifications} hint="The master switch (feature flag)." />
              <Check name="signalAlerts" label="Alert on new high-score signals" checked={notify.signalAlerts} />
              <Check name="jobFailures" label="Alert when a scheduled job fails" checked={notify.jobFailures} />
            </div>
            <div className="max-w-xs">
              <Num name="minScore" label="Alert threshold (score)" value={notify.minScore} min={0} max={100} hint="Baseline or agent score at or above this." />
            </div>
          </SettingsForm>
          <History settingKey={NOTIFICATIONS_KEY} />
        </Section>
      </div>
    </>
  );
}
