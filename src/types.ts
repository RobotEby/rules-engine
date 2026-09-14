/** Dados aceitos nas regras, sem conversões implícitas. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
/** Fatos também admitem propriedades explicitamente undefined. */
export type FactValue = undefined | null | boolean | number | string | FactValue[] | Facts;

export type ComparisonOperator =
  | "eq" // igual
  | "ne" // diferente
  | "gt" // maior que
  | "gte" // maior ou igual
  | "lt" // menor que
  | "lte" // menor ou igual
  | "in" // valor do campo está contido em value (array)
  | "notIn" // valor do campo não está contido em value (array)
  | "exists" // campo presente (e não undefined/null)
  | "notExists"; // campo ausente (undefined/null)

/** Condição atômica: compara um campo dos fatos contra um valor. */
export interface FieldCondition {
  field: string; // caminho em notação de ponto, ex: "destino.regiao"
  operator: ComparisonOperator;
  value?: JsonValue; // não é obrigatório para exists/notExists
}

/** Combinador lógico E: todas as sub-condições devem ser verdadeiras. */
export interface AllCondition {
  all: Condition[];
}

/** Combinador lógico OU: ao menos uma sub-condição deve ser verdadeira. */
export interface AnyCondition {
  any: Condition[];
}

/** Negação lógica. */
export interface NotCondition {
  not: Condition;
}

export type Condition =
  | FieldCondition
  | AllCondition
  | AnyCondition
  | NotCondition;

/** Ação disparada quando as condições de uma regra são satisfeitas. */
export interface RuleAction {
  type: string; // ex: "FREE_SHIPPING", "PERCENT_DISCOUNT"
  params?: JsonObject;
}

export interface Rule {
  id: string;
  description?: string;
  /** Regras com prioridade maior são avaliadas primeiro. Padrão: 0. */
  priority?: number;
  /** Regras desabilitadas são ignoradas na avaliação. Padrão: true. */
  enabled?: boolean;
  conditions: Condition;
  action: RuleAction;
}

export interface RuleSet {
  /** Identificador de versão. Deve ser único por engine (ex.: "1", "2", "2024-06-01-a"). */
  version: string;
  name: string;
  description?: string;
  rules: Rule[];
}

/** Modo de avaliação: parar na primeira regra que casar ou coletar todas. */
export type EvaluationMode = "first-match" | "collect-all";

/** Objeto de dados simples; validado em runtime antes da avaliação. */
export interface Facts { [key: string]: FactValue }

/** Nó de explicação: representa o resultado da avaliação de uma condição. */
export interface ConditionTrace {
  type: "field" | "all" | "any" | "not";
  passed: boolean;
  /** Presente apenas para condições do tipo "field". */
  field?: string;
  operator?: ComparisonOperator;
  expected?: unknown;
  actual?: unknown;
  /** Estado da folha, preservado mesmo quando JSON omite actual: undefined. */
  actualState?: "missing" | "undefined" | "null" | "value";
  /** Presente para "all" | "any" | "not". */
  children?: ConditionTrace[];
}

/** Resultado da avaliação de uma única regra. */
export interface RuleEvaluationResult {
  ruleId: string;
  description?: string;
  priority: number;
  matched: boolean;
  action?: RuleAction;
  trace: ConditionTrace;
}

/** Resultado completo de uma avaliação de fatos contra o ruleset ativo. */
export interface EvaluationResult {
  rulesetVersion: string;
  mode: EvaluationMode;
  /** Ações das regras que casaram, na ordem de avaliação. */
  actions: RuleAction[];
  /** Detalhe regra a regra, incluindo as que não casaram (para depuração). */
  results: RuleEvaluationResult[];
}

export class RuleValidationError extends Error {
  constructor(public errors: string[]) {
    super(`RuleSet inválido:\n- ${errors.join("\n- ")}`);
    this.name = "RuleValidationError";
  }
}

export class RuleSetNotFoundError extends Error {
  constructor(version: string) {
    super(`Versão de ruleset não encontrada: "${version}"`);
    this.name = "RuleSetNotFoundError";
  }
}

export class FactsValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Fatos inválidos:\n- ${errors.join("\n- ")}`);
    this.name = "FactsValidationError";
  }
}
