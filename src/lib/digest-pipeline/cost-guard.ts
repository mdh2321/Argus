// Token + dollar accounting for the digest pipeline.
// Aborts the run if projected spend exceeds the budget.

const HAIKU_PER_M_INPUT = 1.0;
const HAIKU_PER_M_OUTPUT = 5.0;
const SONNET_PER_M_INPUT = 3.0;
const SONNET_PER_M_OUTPUT = 15.0;

interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export class CostGuard {
  private usd = 0;
  private byModel = new Map<string, ModelUsage>();

  constructor(public readonly budgetUsd: number) {}

  addExternal(amountUsd: number) {
    this.usd += amountUsd;
    this.assertWithinBudget();
  }

  recordAnthropic(model: string, usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }) {
    const m = this.byModel.get(model) ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    m.inputTokens += usage.inputTokens;
    m.outputTokens += usage.outputTokens;
    m.cachedInputTokens += usage.cachedInputTokens ?? 0;
    this.byModel.set(model, m);

    const isHaiku = model.includes("haiku");
    const inRate = isHaiku ? HAIKU_PER_M_INPUT : SONNET_PER_M_INPUT;
    const outRate = isHaiku ? HAIKU_PER_M_OUTPUT : SONNET_PER_M_OUTPUT;
    // Cached input is billed at ~10% of normal rate (assumes cache hit).
    const billableInput = usage.inputTokens + (usage.cachedInputTokens ?? 0) * 0.1;
    const cost = (billableInput / 1_000_000) * inRate + (usage.outputTokens / 1_000_000) * outRate;
    this.usd += cost;
    this.assertWithinBudget();
  }

  totalUsd(): number {
    return this.usd;
  }

  summary() {
    const models: Record<string, ModelUsage> = {};
    for (const [k, v] of this.byModel.entries()) models[k] = v;
    return { usd: this.usd, models };
  }

  private assertWithinBudget() {
    if (this.usd > this.budgetUsd) {
      throw new Error(
        `CostGuard: budget exceeded ($${this.usd.toFixed(2)} > $${this.budgetUsd.toFixed(2)})`
      );
    }
  }
}
