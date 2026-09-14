import type {
  EvaluationMode,
  EvaluationResult,
  Facts,
  Rule,
  RuleEvaluationResult,
  RuleSet,
} from "./types.js";
import { RuleSetNotFoundError, RuleValidationError } from "./types.js";
import { validateRuleSet } from "./validation.js";
import { evaluateCondition } from "./conditions.js";

interface LoadedRuleSet {
  ruleset: RuleSet;
  loadedAt: Date;
}

export interface RulesEngineOptions {
  mode?: EvaluationMode;
}

export class RulesEngine {
  private history = new Map<string, LoadedRuleSet>();
  private currentVersion: string | null = null;
  private mode: EvaluationMode;

  constructor(initialRuleSet?: unknown, options: RulesEngineOptions = {}) {
    this.mode = options.mode ?? "collect-all";
    if (initialRuleSet !== undefined) {
      this.loadRuleSet(initialRuleSet);
    }
  }

  loadRuleSet(input: unknown): RuleSet {
    const { valid, errors } = validateRuleSet(input);
    if (!valid) {
      throw new RuleValidationError(errors);
    }
    const ruleset = input as RuleSet;
    if (this.history.has(ruleset.version)) {
      throw new RuleValidationError([
        `já existe uma versão carregada com o identificador "${ruleset.version}"; use um identificador de versão novo`,
      ]);
    }
    this.history.set(ruleset.version, { ruleset, loadedAt: new Date() });
    this.currentVersion = ruleset.version;
    return ruleset;
  }

  getCurrentVersion(): string {
    if (!this.currentVersion) {
      throw new Error(
        "Nenhum RuleSet carregado ainda. Chame loadRuleSet() primeiro.",
      );
    }
    return this.currentVersion;
  }

  listVersions(): {
    version: string;
    name: string;
    rulesCount: number;
    loadedAt: Date;
    active: boolean;
  }[] {
    return [...this.history.values()]
      .sort((a, b) => a.loadedAt.getTime() - b.loadedAt.getTime())
      .map(({ ruleset, loadedAt }) => ({
        version: ruleset.version,
        name: ruleset.name,
        rulesCount: ruleset.rules.length,
        loadedAt,
        active: ruleset.version === this.currentVersion,
      }));
  }

  rollback(version: string): void {
    if (!this.history.has(version)) {
      throw new RuleSetNotFoundError(version);
    }
    this.currentVersion = version;
  }

  private getActiveRuleSet(): RuleSet {
    const version = this.getCurrentVersion();
    return this.history.get(version)!.ruleset;
  }

  evaluate(facts: Facts): EvaluationResult {
    const ruleset = this.getActiveRuleSet();
    const orderedRules = [...ruleset.rules]
      .map((rule, index) => ({ rule, index }))
      .sort(
        (a, b) =>
          (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || a.index - b.index,
      )
      .map(({ rule }) => rule);

    const results: RuleEvaluationResult[] = [];
    const actions: EvaluationResult["actions"] = [];

    for (const rule of orderedRules) {
      if (rule.enabled === false) {
        continue;
      }
      const trace = evaluateCondition(rule.conditions, facts);
      const result: RuleEvaluationResult = {
        ruleId: rule.id,
        description: rule.description,
        priority: rule.priority ?? 0,
        matched: trace.passed,
        action: trace.passed ? rule.action : undefined,
        trace,
      };
      results.push(result);
      if (trace.passed) {
        actions.push(rule.action);
        if (this.mode === "first-match") {
          break;
        }
      }
    }

    return {
      rulesetVersion: ruleset.version,
      mode: this.mode,
      actions,
      results,
    };
  }

  explain(facts: Facts): EvaluationResult {
    return this.evaluate(facts);
  }

  getActiveRules(): Rule[] {
    return this.getActiveRuleSet().rules;
  }
}
