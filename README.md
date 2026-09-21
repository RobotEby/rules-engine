# rules-engine

[![CI](https://github.com/RobotEby/rules-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/RobotEby/rules-engine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](./LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)

Motor de regras de negócio em TypeScript: condições definidas em JSON,
versionamento com rollback e explicação completa de cada avaliação. Zero
dependências de runtime. Inclui uma aplicação de exemplo (frete e desconto
de checkout) com API HTTP.

- [Por que sem dependências?](#por-que-sem-dependências)
- [Instalação](#instalação)
- [Uso rápido](#uso-rápido)
- [Conceitos](#conceitos)
- [Explicabilidade](#explicabilidade)
- [API HTTP local](#api-http-local)
- [Build e consumo do pacote](#build-e-consumo-do-pacote)
- [Cobertura e CI](#cobertura-e-ci)
- [Roadmap](#roadmap)

## Por que sem dependências?

O núcleo não usa nenhuma biblioteca externa: sem `ajv`, sem framework de
testes. A validação de schema é feita à mão em `src/validation.ts`, e os
testes rodam no test runner nativo do Node (`node:test`). O objetivo é manter
o motor pequeno o bastante para ser lido de ponta a ponta e embutido em
qualquer projeto sem trazer uma árvore de dependências junto.
`typescript`, `tsx` e `@types/node` existem só como devDependencies, para
build e execução em desenvolvimento.

## Instalação

Requer Node **22.0.0 ou superior**. O pacote é ESM e usa apenas APIs nativas
do Node.

```bash
npm ci
```

## Uso rápido

```bash
npm run demo          # cenários com assertions: hot-reload, rollback, explicação
npm run server        # API local em 127.0.0.1:3000 (rotas administrativas exigem ADMIN_TOKEN)
npm test              # testes fonte, incluindo integração HTTP
npm run build         # limpa dist, compila e copia os JSONs dos exemplos
npm run demo:dist     # executa a demo a partir do build
npm run server:dist   # executa o servidor a partir do build
npm run test:dist     # roda a suíte contra o build
npm run test:package  # npm pack + instalação em pasta temporária: ESM, tipos, demo, HTTP
npm run lint          # ESLint (flat config, com verificação de tipos)
npm run typecheck     # tsc --noEmit sobre src/examples/tests
npm run test:coverage # cobertura de src/ com piso mínimo (requer Node 22.8.0+)
```

## Conceitos

### Regra (`Rule`)

```jsonc
{
  "id": "frete-gratis-regioes-elegiveis",
  "description": "Frete grátis para pedidos a partir de R$200 no Sudeste/Sul",
  "priority": 10,       // maior = avaliada primeiro (padrão: 0)
  "enabled": true,      // regras desabilitadas são ignoradas (padrão: true)
  "conditions": {
    "all": [
      { "field": "valorPedido", "operator": "gte", "value": 200 },
      { "field": "destino.regiao", "operator": "in", "value": ["Sudeste", "Sul"] }
    ]
  },
  "action": { "type": "FREE_SHIPPING", "params": { "motivo": "..." } }
}
```

### Condições combináveis

- Atômica: `{ "field": "...", "operator": "...", "value": ... }`
- `all`: E lógico - `{ "all": [cond, cond, ...] }`
- `any`: OU lógico - `{ "any": [cond, cond, ...] }`
- `not`: negação - `{ "not": cond }`

Combinadores podem ser aninhados, dentro dos limites descritos mais abaixo.

Operadores disponíveis: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`,
`exists`, `notExists`.

`field` usa notação de ponto (`destino.regiao`). Cada segmento lê apenas
propriedades próprias do dado, sem executar getters nem ler campos herdados.
Objetos sem protótipo e índices de array (`itens.0.valor`) funcionam
normalmente; um intermediário ausente, `null` ou primitivo resolve para campo
ausente. Segmentos vazios e `__proto__`, `prototype` ou `constructor` são
rejeitados na validação da regra. `getByPath()` retorna `undefined` nesses
casos.

### Campo ausente, presença e negação

`exists` é verdadeiro para qualquer valor diferente de `undefined` e `null`;
`notExists` é o inverso. `false`, `0` e `""` contam como presentes. Um campo
ausente **atende** a `ne`, `notIn` e a condições negadas com `not` - isso é
intencional, não uma pegadinha:

| Fato em `x` | `exists` | `notExists` | `ne: "A"` | `notIn: ["A"]` | `not(eq: "A")` | `actualState` |
| --- | --- | --- | --- | --- | --- | --- |
| Propriedade ausente | false | true | true | true | true | `missing` |
| `undefined` explícito | false | true | true | true | true | `undefined` |
| `null` | false | true | true | true | true | `null` |
| `false`, `0`, `""` | true | false | true | true | true | `value` |

`eq`/`ne` usam igualdade estrita; `in`/`notIn` usam `includes` (`eq: null`
atende só a `null`; `notIn: [null]` não atende a `null`). Quando a regra
precisa exigir que o dado exista, expresse isso explicitamente:

```json
{
  "all": [
    { "field": "destino.regiao", "operator": "exists" },
    { "not": { "field": "destino.regiao", "operator": "eq", "value": "Norte" } }
  ]
}
```

### RuleSet

```jsonc
{
  "version": "1",       // identificador único da versão (string livre)
  "name": "frete-e-desconto",
  "rules": [ /* Rule[] */ ]
}
```

### Motor (`RulesEngine`)

```ts
import { RulesEngine } from "rules-engine";

const engine = new RulesEngine(ruleSetV1, { mode: "collect-all" }); // ou "first-match"

engine.evaluate(fatos);        // -> EvaluationResult (ações + trace por regra)
engine.explain(fatos);         // idêntico a evaluate(), nome mais claro para depuração
engine.loadRuleSet(ruleSetV2); // valida e ativa: novas avaliações já usam v2
engine.listVersions();         // histórico de versões carregadas na sessão
engine.rollback("1");          // volta a versão ativa para v1
engine.getCurrentVersion();    // "1" | "2" | ...
engine.getActiveRules();       // cópia das regras, na ordem original
```

`loadRuleSet` valida a entrada, copia, congela a cópia interna e prepara a
ordenação antes de ativar a nova versão - se a validação falhar, a versão
ativa e todo o histórico permanecem intactos. `RuleValidationError` traz os
caminhos inválidos. Identificadores de versão não podem se repetir, mesmo
depois de um rollback; um rollback para uma versão inexistente lança
`RuleSetNotFoundError` sem alterar a versão ativa.

As regras são ordenadas uma vez por versão: prioridade decrescente (padrão
zero), desempate pela ordem original. Regras desabilitadas são ignoradas. No
modo `first-match`, a avaliação para na primeira regra atendida; em
`collect-all`, todas as ações de regras atendidas são retornadas.

### Cópias e referências

Modificar a entrada original, o que `loadRuleSet`/`getActiveRules` retornam,
ações, traces ou datas de `listVersions` nunca afeta o estado interno do
motor - nem o inverso: o motor não modifica nem congela objetos que vêm de
fora. Um rollback sempre recupera a cópia original daquela versão.

Dentro de uma mesma resposta pode haver aliases (a mesma ação aparecendo em
`actions` e em `results`), mas isso nunca compartilha estado com o motor.
`trace.expected`/`trace.actual` também são cópias: alterar fatos depois de
uma avaliação não muda traces já retornados.

Comparações continuam por **identidade**, não por igualdade profunda - depois
de `loadRuleSet`, o valor interno já é outra cópia, então compartilhar um
objeto entre a regra original e os fatos não os torna "iguais" para o motor.
Para expressar igualdade de conteúdo, compare campos escalares.
`getByPath` é só leitura e retorna uma referência direta ao dado do chamador
(não copia, não acessa versões internas). `evaluateCondition`, o helper
independente de avaliação de uma condição isolada, também copia apenas o
trace.

### Validação isolada

```ts
import { validateRuleSet, validateFacts } from "rules-engine";
const { valid, errors } = validateRuleSet(jsonQualquer);
const validation = validateFacts(fatos);
```

Útil para validar um `RuleSet` antes de publicá-lo (por exemplo, num pipeline
de CI ou numa tela de administração) sem precisar instanciar o motor.
`evaluate`/`explain` validam fatos internamente e lançam
`FactsValidationError` para entradas inválidas; `evaluateCondition` valida
tanto a condição quanto os fatos, lançando `RuleValidationError` quando a
condição é inválida.

### Domínio de valores e limites

- Regras aceitam `null`, booleanos, strings, números finitos, arrays densos e
  objetos simples com protótipo `Object.prototype` ou `null`.
- Fatos têm raiz objeto e aceitam os mesmos dados, mais `undefined` explícito.
- Ciclos, `Date`, `Map`, `Set`, `RegExp`, instâncias de classe, funções,
  `bigint`, símbolos, proxies, accessors, propriedades não enumeráveis,
  arrays esparsos e propriedades extras em arrays são rejeitados. Estruturas
  compartilhadas sem ciclo são aceitas normalmente.
- A cópia é estrutural (não usa `JSON.stringify`/`parse`, não converte
  valores): objetos congelados são aceitos, e valores como `-0` são
  preservados exatamente.
- Propriedades desconhecidas em ruleset, regra, ação ou condição são erro de
  validação - um `enabld: false` digitado errado não deixa a regra habilitada
  por engano. Fatos, `action.params` e objetos usados como valor de condição
  aceitam chaves livres.
- `description` deve ser string, `enabled` booleano, `priority` número
  finito; `action.params`, quando presente, deve ser objeto. Campos opcionais
  devem ser omitidos quando ausentes - `description: undefined`, por
  exemplo, não é um valor JSON válido.
- `gt`/`gte`/`lt`/`lte` exigem `value` numérico finito; `in`/`notIn` exigem
  array. `eq`/`ne` exigem `value` e aceitam qualquer valor do domínio JSON,
  incluindo `null`. `exists`/`notExists` dispensam `value`.
- Cada condição contém exclusivamente campos de comparação, ou `all`, `any`
  ou `not` - nunca uma mistura. `all`/`any` exigem arrays não vazios.

Os tipos públicos incluem `JsonValue`, `JsonObject`, `FactValue`, `Facts`,
`RulesEngineOptions`, `ValidationResult` e as classes de erro específicas.

| Limite | Valor |
| --- | ---: |
| Profundidade estrutural (raiz = 0) | 64 |
| Regras por versão | 1.000 |
| Condições por versão ou condição independente | 10.000 |
| Valores visitados por entrada | 100.000 |

Cada propriedade ou elemento conta como um valor, containers incluídos
(inclusive a raiz); ocorrências compartilhadas são contadas de novo, o que
impede que um grafo compacto contorne o limite. Os mesmos limites protegem
fatos e valores aninhados em ações, e um excesso retorna erro com o caminho
exato antes de copiar ou avaliar qualquer coisa. São constantes exportadas em
`VALIDATION_LIMITS`; não há configuração dinâmica nesta versão.

## Explicabilidade

Todo resultado de `evaluate`/`explain` traz, por regra, uma árvore `trace`
com cada condição folha avaliada (campo, operador, valor esperado, valor
real) e o resultado de cada combinador - dá para responder "por que essa
regra casou ou não casou" sem instrumentar nada.

Todas as condições de uma regra aparecem no trace, mesmo quando o resultado
de `all`/`any` já está decidido. `explain()` tem exatamente o mesmo contrato
de `evaluate()`; é só um nome mais claro para uso em depuração. Folhas
incluem `actualState`: `missing`, `undefined`, `null` ou `value`:

```json
{ "type": "field", "field": "destino.regiao", "operator": "exists", "passed": false, "actualState": "missing" }
```

Em JavaScript, `actual` existe com valor `undefined` para os dois primeiros
estados; a serialização JSON omite esse atributo, mas preserva
`actualState`. Valores `null`, `false`, `0` e `""` em `actual` são mantidos
normalmente.

### Cenários da demo

A demo roda como uma suíte de assertions e falha se qualquer expectativa não
se confirmar. Na v1 do ruleset, o frete grátis exige R$200 no Sudeste/Sul; na
v2, R$150 no Sudeste/Sul/Centro-Oeste:

| Pedido | Frete na v1 | Frete na v2 |
| --- | --- | --- |
| R$180 no Sudeste | Não | Sim |
| R$250 no Centro-Oeste | Não | Sim |
| R$149,99 no Sudeste | Não | Não |
| R$150 no Sudeste | Não | Sim |
| R$199,99 no Sudeste | Não | Sim |
| R$200 no Sudeste | Sim | Sim |
| R$500, primeira compra, sem região | Não | Não |

Um pedido de R$500 com seis itens e primeira compra retorna as ações de 10%
e 5% separadamente - o núcleo (e a demo) não somam nem aplicam descontos por
conta própria; isso é decisão da aplicação consumidora. A demo também cobre
rejeição de atualização inválida, preservação de histórico, rollback e o
erro esperado quando a regra procurada para explicação não existe.

## API HTTP local

O servidor de exemplo escuta em **127.0.0.1** (sem opção `HOST`). `PORT`
define uma porta entre 0 e 65535 (padrão 3000; `0` escolhe uma porta livre).
`createDemoServer({ engine, adminToken })` é uma fábrica pura - não inicia
escuta ao ser importada.

```bash
export ADMIN_TOKEN="token-local-escolhido-por-voce"
npm run server
```

Em outro terminal, com o mesmo token para as rotas administrativas:

```bash
export ADMIN_TOKEN="token-local-escolhido-por-voce"
curl http://127.0.0.1:3000/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"valorPedido":180,"quantidadeItens":3,"destino":{"regiao":"Sudeste"},"cliente":{"primeiraCompra":true}}'

curl http://127.0.0.1:3000/rules \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @examples/rules-frete-desconto.v2.json

curl http://127.0.0.1:3000/rules/versions -H "Authorization: Bearer $ADMIN_TOKEN"
curl http://127.0.0.1:3000/rules/rollback \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"version":"1"}'
```

| Rota | Contrato | Sucesso |
| --- | --- | --- |
| `POST /evaluate` | Objeto de fatos JSON | 200 |
| `POST /rules` | RuleSet válido, versão nova; exige token | 201 |
| `GET /rules/versions` | Exige token | 200 |
| `POST /rules/rollback` | Somente `version`, string não vazia; exige token | 200 |

JSON malformado ou falha de leitura: **400**. Corpo incompatível, regra
inválida ou versão duplicada: **422**. Rollback ou rota inexistente: **404**.
Corpo acima de **1 MiB** (contado em bytes, inclusive envio chunked): **413**.
Credenciais ausentes ou incorretas: **401**. Sem `ADMIN_TOKEN` configurado
(ou vazio), todas as rotas `/rules` respondem **503**, mas `/evaluate`
continua disponível normalmente. A autenticação acontece antes da leitura do
corpo da requisição.

Falhas inesperadas retornam **500** com mensagem genérica (detalhes ficam no
log do servidor) e nunca alteram a versão ativa. Se o cliente interrompe a
conexão, a leitura é cancelada sem carregar nenhuma versão. `SIGINT`/`SIGTERM`
encerram o servidor e as conexões abertas de forma graciosa.

## Build e consumo do pacote

O build remove `dist`, compila e copia os dois JSONs de exemplo para
`dist/examples`. `main`, `types` e `exports` apontam para
`dist/src/index.js`/`.d.ts`. O pacote publicado carrega só `dist/src`,
`dist/examples`, o `README.md` e a `LICENSE` - os testes ficam no
repositório, fora do pacote.

```bash
npm pack                 # prepack roda o build; gera um .tgz local
npm run test:package     # instala esse .tgz numa pasta temporária, sem publicar nada
```

A verificação de empacotamento importa `rules-engine` pela entrada pública,
checa os tipos com TypeScript/NodeNext, roda a demo já instalada e testa a
API HTTP tanto na versão compilada quanto na instalada, com portas
temporárias e encerramento por `SIGTERM`.

## Cobertura e CI

O workflow em `.github/workflows/ci.yml` roda em todo push e pull request: um
job de lint + typecheck, seguido de testes em matriz contra Node `22.0.0`
(piso mínimo declarado em `engines`), `22` e `24`. Todas as versões rodam
`test`, `build`, `test:dist`, `demo` e `test:package`.

`npm run test:coverage` mede linhas, branches e funções de `src/` (excluindo
o barrel `index.ts` e o arquivo só-de-tipos `types.ts`) e falha se cair
abaixo de 90% linhas, 90% branches ou 95% funções. Esse comando precisa de
Node **22.8.0+** - `--test-coverage-lines`, `--test-coverage-branches` e
`--test-coverage-functions` não existem em versões anteriores - por isso não
roda na entrada `22.0.0` da matriz, só nas demais.

## Roadmap

Itens deliberadamente fora do escopo desta primeira versão:

- Persistir o histórico de versões em disco/banco (hoje vive em memória, por
  instância do motor).
- Watch de arquivo (`fs.watch`) para hot-reload automático a partir de um
  JSON em disco.
- Um segundo tipo de "value" dinâmico (por exemplo,
  `{ "field": "b" }`, para comparar dois campos entre si).
- Resolução de conflito mais rica entre ações do mesmo tipo - hoje quem
  decide é o consumidor da lista de `actions`.

## Licença

 [`MIT - Ver`](./LICENSE)
