import type {
  EvaluationMode,
  EvaluationResult,
  Facts,
  Rule,
  RuleEvaluationResult,
  RuleSet,
} from "./types.js";
import { RuleSetNotFoundError, RuleValidationError } from "./types.js";
import { assertRuleSet, assertFacts } from "./validation.js";
import { evaluateValidatedCondition } from "./conditions.js";
import { copyData, freezeData } from "./data.js";

interface LoadedRuleSet {
  ruleset: RuleSet;
  loadedAt: number;
}

export interface RulesEngineOptions {
  mode?: EvaluationMode;
}

export class RulesEngine {
  #history = new Map<string, LoadedRuleSet>();
  #currentVersion: string | null = null;
  private mode: EvaluationMode;

  constructor(initialRuleSet?: unknown, options: RulesEngineOptions = {}) {
    this.mode = options.mode ?? "collect-all";
    if (initialRuleSet !== undefined) {
      this.loadRuleSet(initialRuleSet);
    }
  }

  loadRuleSet(input: unknown): RuleSet {
    assertRuleSet(input);
    if (this.#history.has(input.version)) {
      throw new RuleValidationError([
        `já existe uma versão carregada com o identificador "${input.version}"; use um identificador de versão novo`,
      ]);
    }
    const ruleset = freezeData(copyData(input));
    const returned = copyData(ruleset);
    const loadedAt = Date.now();
    this.#history.set(ruleset.version, { ruleset, loadedAt });
    this.#currentVersion = ruleset.version;
    return returned;
  }

  getCurrentVersion(): string {
    if (!this.#currentVersion) {
      throw new Error(
        "Nenhum RuleSet carregado ainda. Chame loadRuleSet() primeiro.",
      );
    }
    return this.#currentVersion;
  }

  listVersions(): {
    version: string;
    name: string;
    rulesCount: number;
    loadedAt: Date;
    active: boolean;
  }[] {
    return [...this.#history.values()]
      .sort((a, b) => a.loadedAt - b.loadedAt)
      .map(({ ruleset, loadedAt }) => ({
        version: ruleset.version,
        name: ruleset.name,
        rulesCount: ruleset.rules.length,
        loadedAt: new Date(loadedAt),
        active: ruleset.version === this.#currentVersion,
      }));
  }

  rollback(version: string): void {
    if (!this.#history.has(version)) {
      throw new RuleSetNotFoundError(version);
    }
    this.#currentVersion = version;
  }

  private getActiveRuleSet(): RuleSet {
    const version = this.getCurrentVersion();
    return this.#history.get(version)!.ruleset;
  }

  evaluate(facts: Facts): EvaluationResult {
    const ruleset = this.getActiveRuleSet();
    assertFacts(facts);
    const copies = new Map<object, object>();
    const orderedRules = Array.from(ruleset.rules)
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
      const trace = evaluateValidatedCondition(rule.conditions, facts, copies);
      const action = trace.passed ? copyData(rule.action, copies) : undefined;
      const result: RuleEvaluationResult = {
        ruleId: rule.id,
        description: rule.description,
        priority: rule.priority ?? 0,
        matched: trace.passed,
        action,
        trace,
      };
      results.push(result);
      if (trace.passed) {
        actions.push(action!);
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
    return copyData(this.getActiveRuleSet().rules);
  }
}
