# rules-engine

Motor de regras em JSON, escrito em TypeScript, sem dependências de runtime.
Inclui uma aplicação demonstrativa de descontos e frete.

## Por que sem dependências?

O motor não depende de nenhuma lib externa (nada de ajv, nada de framework de
testes): a validação de schema é feita à mão em `src/validation.ts` e os
testes usam o test runner nativo do Node (`node:test`). Isso deixa o núcleo
fácil de auditar e de embutir em qualquer projeto. `typescript`, `tsx` e
`@types/node` são apenas devDependencies (build/execução em dev).

## Instalação

Node **22.0.0 ou superior**. O pacote é ESM e usa APIs nativas do Node.
Esta revisão foi verificada com Node 22.0.0/npm 10.7.0 e Node 24.18.1/npm 11.16.0:
122 testes fonte e 122 compilados em cada ambiente, build limpo, demos e consumo
do pacote com tipos e HTTP. Outras versões não foram executadas nesta revisão.

```bash
npm ci
```

## Uso rápido

```bash
npm run demo          # cenários com assertions, hot-reload, rollback e explicação
npm run server        # API local em 127.0.0.1:3000; administração desabilitada sem token
npm test              # testes fonte, incluindo integração HTTP
npm run build         # limpa dist, compila e copia os JSONs dos exemplos
npm run demo:dist     # executa a demo compilada
npm run server:dist   # executa o servidor compilado
npm run test:dist     # executa os testes compilados
npm run test:package  # npm pack + consumidor temporário: ESM, tipos, demo e HTTP
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
- `all`: E lógico — `{ "all": [cond, cond, ...] }`
- `any`: OU lógico — `{ "any": [cond, cond, ...] }`
- `not`: negação — `{ "not": cond }`
- Combinadores podem ser aninhados dentro dos limites documentados abaixo.

Operadores: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `exists`, `notExists`.

`field` usa notação de ponto (`destino.regiao`). Cada segmento lê somente
propriedades próprias de dados, sem executar getters. Campos herdados não
são lidos. Objetos sem protótipo e índices de arrays (`itens.0.valor`) são
aceitos; intermediários ausentes, primitivos ou nulos resultam em campo ausente.
Segmentos vazios e `__proto__`, `prototype` ou `constructor` são rejeitados
na validação das regras. O helper `getByPath()` retorna `undefined` nesses casos.

### Campo ausente, presença e negação

As comparações existentes foram preservadas. `exists` significa valor diferente
de `undefined` e `null`; `notExists` é seu inverso. `false`, `0` e `""` existem.
Ausência **pode atender** a `ne`, `notIn` e condições negadas com `not`.

| Fato em `x` | `exists` | `notExists` | `ne: "A"` | `notIn: ["A"]` | `not(eq: "A")` | `actualState` |
| --- | --- | --- | --- | --- | --- | --- |
| Propriedade ausente | false | true | true | true | true | `missing` |
| `undefined` explícito | false | true | true | true | true | `undefined` |
| `null` | false | true | true | true | true | `null` |
| `false`, `0`, `""` | true | false | true | true | true | `value` |

`eq`/`ne` usam igualdade estrita; `in`/`notIn` usam `includes`. Por exemplo,
`eq: null` atende somente a `null`; `notIn: [null]` não atende a `null`.
`all` e `any` combinam os resultados normalmente, e `not` sempre inverte o filho.
Quando o negócio exigir o dado, expresse a presença na regra:

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
engine.explain(fatos);         // idêntico a evaluate(), nome mais claro p/ depuração
engine.loadRuleSet(ruleSetV2); // valida e hot-reload: novas avaliações já usam v2
engine.listVersions();         // histórico de versões carregadas na sessão
engine.rollback("1");          // volta a versão ativa para v1
engine.getCurrentVersion();    // "1" | "2" | ...
engine.getActiveRules();       // cópia das regras, na ordem original
```

`loadRuleSet` valida, copia, congela a cópia interna e prepara a ordenação e o
retorno antes de ativar a versão. Falhas lançam `RuleValidationError` com os
caminhos inválidos e preservam a versão ativa e todo o histórico. Versões
duplicadas continuam proibidas, inclusive após rollback. Um rollback inexistente
lança `RuleSetNotFoundError` sem alterar a versão ativa.

As regras são ordenadas uma vez por versão: prioridade decrescente, padrão zero,
desempate pela ordem original. Desabilitadas são ignoradas. `first-match` encerra
na primeira regra atendida; `collect-all` coleta todas as ações atendidas.

### Cópias e referências

Modificar a entrada original, o retorno de `loadRuleSet`, `getActiveRules`, ações,
traces ou datas de `listVersions` não modifica as versões guardadas. O rollback
recupera a cópia original. O motor não modifica nem congela os objetos do chamador.

Resultados públicos são cópias mutáveis, independentes entre chamadas. Dentro da
mesma resposta pode haver aliases: uma ação em `actions` pode ser o mesmo objeto
da ação correspondente em `results`. Isso não compartilha estado com o motor.
`trace.expected` e `trace.actual` também são cópias; alterar fatos depois da
avaliação não altera traces anteriores. Fatos novos ou modificados, naturalmente,
podem mudar a avaliação seguinte.

`getByPath` é um helper de leitura: seu retorno é uma referência ao dado do
chamador, sem cópia. Ele não acessa versões internas.

Objetos e arrays continuam sendo comparados por **identidade**, sem igualdade
profunda. Depois de `loadRuleSet`, o valor interno já é outra cópia: compartilhar
um objeto entre a regra original e os fatos deixa de fazê-los iguais. Compare
campos escalares para expressar igualdade de conteúdo. O helper independente
`evaluateCondition` compara os valores recebidos e copia somente o trace.

### Validação isolada

```ts
import { validateRuleSet, validateFacts } from "rules-engine";
const { valid, errors } = validateRuleSet(jsonQualquer);
const validation = validateFacts(fatos);
```

Útil para validar um RuleSet antes de publicá-lo (ex.: num pipeline de CI ou
numa tela de admin), sem precisar instanciar o motor.

`evaluate` e `explain` validam fatos e lançam `FactsValidationError` para entradas
inválidas. `evaluateCondition` também valida sua condição e os fatos; condições
inválidas lançam `RuleValidationError`.

### Domínio de valores e validação

- Regras aceitam `null`, booleanos, strings, números finitos, arrays densos e
  objetos simples com protótipo `Object.prototype` ou `null`.
- Fatos têm raiz objeto e aceitam os mesmos dados, mais `undefined` explícito.
- Ciclos, Date, Map, Set, RegExp, instâncias de classes, funções, bigint, símbolos,
  proxies, accessors, propriedades não enumeráveis, arrays esparsos e propriedades
  extras em arrays são rejeitados. Estruturas compartilhadas sem ciclos são aceitas.
- A cópia é estrutural: não usa `JSON.stringify`/`parse` e não converte valores.
  Objetos congelados são aceitos; valores como `-0` são preservados.
- Propriedades desconhecidas no ruleset, regra, ação ou condição são erros. Assim,
  `enabld: false` não deixa uma regra habilitada por engano. Fatos, `action.params`
  e objetos usados como valores permitem chaves de dados livres.
- `description` deve ser string, `enabled` booleano e `priority` número finito.
  `action.params`, quando presente, deve ser objeto. Opcionais devem ser omitidos
  quando ausentes: `description: undefined`, por exemplo, não pertence ao domínio JSON.
- `gt`, `gte`, `lt`, `lte` exigem `value` numérico finito; `in`/`notIn` exigem array.
  `eq`/`ne` exigem `value` e aceitam qualquer valor do domínio JSON, inclusive `null`.
  `exists`/`notExists` dispensam `value`; se fornecido, deve ser JSON válido e é ignorado.
- Cada condição contém exclusivamente campos de comparação, `all`, `any` ou `not`.
  `all`/`any` exigem arrays não vazios; `not` exige uma condição válida.

Os tipos públicos incluem `JsonValue`, `JsonObject`, `FactValue`, `Facts`,
`RulesEngineOptions`, `ValidationResult` e os erros específicos. Números finitos,
chaves desconhecidas e limites são verificados em runtime.

### Limites por entrada

| Limite | Valor |
| --- | ---: |
| Profundidade estrutural (raiz = 0) | 64 |
| Regras por versão | 1.000 |
| Condições por versão ou condição independente | 10.000 |
| Valores visitados por entrada | 100.000 |

Cada propriedade/elemento conta como um valor; containers também contam, inclusive
a raiz. Arrays e objetos aumentam a profundidade estrutural, não apenas combinadores.
Ocorrências compartilhadas são contadas novamente, impedindo que um grafo compacto
contorne o limite. Os limites também protegem fatos e valores aninhados em ações;
excessos retornam erros com caminho, antes de copiar ou avaliar. São constantes
exportadas em `VALIDATION_LIMITS`, sem configuração dinâmica nesta versão.

## Explicabilidade

Todo resultado de `evaluate`/`explain` traz, por regra, uma árvore `trace`
mostrando cada condição folha avaliada (campo, operador, valor esperado,
valor real) e o resultado de cada combinador — dá para responder "por que
essa regra casou/não casou" sem re-instrumentar nada.

Todas as condições de uma regra avaliada aparecem no trace, mesmo quando o resultado
de `all`/`any` já é conhecido. `explain()` mantém o mesmo contrato de `evaluate()`.
Folhas incluem `actualState`: `missing`, `undefined`, `null` ou `value`. Por exemplo:

```json
{ "type": "field", "field": "destino.regiao", "operator": "exists", "passed": false, "actualState": "missing" }
```

Em JavaScript, `actual` existe com valor `undefined` para os dois primeiros estados;
JSON omite esse atributo, mas preserva `actualState`. `actual: null`, `false`, `0`
e `""` são mantidos. O estado descreve o campo consultado: valores `undefined`
dentro de objetos/arrays em `actual` seguem as regras normais de serialização JSON.

## Cenários da demonstração

A demo executa assertions e encerra com erro se alguma expectativa falhar.
Na v1, o frete exige R$200 e Sudeste/Sul; na v2, R$150 e Sudeste/Sul/Centro-Oeste.

| Pedido | Frete na v1 | Frete na v2 |
| --- | --- | --- |
| R$180 no Sudeste | Não | Sim |
| R$250 no Centro-Oeste | Não | Sim |
| R$149,99 no Sudeste | Não | Não |
| R$150 no Sudeste | Não | Sim |
| R$199,99 no Sudeste | Não | Sim |
| R$200 no Sudeste | Sim | Sim |
| R$500, primeira compra, sem região | Não | Não |

O pedido sem região mantém o cliente e recebe 5%. Um pedido de R$500 com seis itens
e primeira compra retorna as ações de 10% e 5% separadamente. A aplicação decide
se e como combinar descontos; o núcleo e a demo não os somam nem aplicam.
`validateCheckoutActions`, no exemplo, verifica percentuais entre 0 e 100.
A demo também confirma rejeição de atualização inválida, histórico preservado,
rollback e falha explícita se a regra procurada para explicação não existir.

## API HTTP local

O servidor de demonstração escuta em **127.0.0.1**, sem opção `HOST`.
`PORT` define uma porta entre 0 e 65535 (padrão 3000; zero escolhe uma porta livre).
A fábrica `createDemoServer({ engine, adminToken })` não inicia escuta ao importar
o módulo; os testes fazem o bind local e encerram as conexões ao terminar.

```bash
export ADMIN_TOKEN="token-local-escolhido-por-voce"
npm run server
```

Em outro terminal, configure o mesmo token para as operações administrativas:

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

JSON malformado ou falha de leitura: **400**. Corpo incompatível, regra inválida
ou versão duplicada: **422**. Versão de rollback/rota inexistente: **404**.
Corpo acima de **1 MiB**, contado em bytes, inclusive envio chunked: **413**.
Credenciais ausentes/incorretas: **401**. Sem `ADMIN_TOKEN` ou com token vazio,
todas as rotas `/rules` ficam desabilitadas com **503**; avaliação continua disponível.
A autenticação administrativa ocorre antes da leitura/validação do corpo.

Falhas inesperadas recebem **500** com mensagem genérica; detalhes ficam no log
do servidor. Requisições rejeitadas preservam a versão ativa. Se o cliente interromper
a conexão, a leitura é encerrada sem carregar versão; uma conexão já encerrada
não consegue receber resposta. SIGINT/SIGTERM encerram servidor e conexões.

## Build e consumo do pacote

O build sempre remove `dist`, compila e copia os dois JSONs para `dist/examples`.
`main`, `types` e `exports` apontam para `dist/src/index.js` e `dist/src/index.d.ts`.
O pacote distribui somente `dist/src`, `dist/examples`, README e metadados; testes
compilados ficam disponíveis no repositório, fora do pacote.

```bash
npm pack                 # prepack executa build limpo; gera .tgz local
npm run test:package     # instala um .tgz em pasta temporária, sem publicar
```

A verificação de consumo importa `rules-engine` pela entrada pública, verifica
tipos com TypeScript/NodeNext, executa a demo instalada e testa HTTP nos servidores
compilado e instalado, com portas temporárias e encerramento por SIGTERM.

### Compatibilidade e migração

- As novas rejeições de domínio, propriedades desconhecidas e limites são restrições
  de compatibilidade. Converta dados especiais explicitamente antes de chamar o motor.
- Corrija erros de digitação, operandos numéricos em strings e opcionais inválidos.
  Nenhuma regra comercial de checkout foi adicionada ao núcleo.
- Atualize referências ao ID antigo `frete-gratis-sudeste` para
  `frete-gratis-regioes-elegiveis` nos exemplos e consumidores que usem esse ID.
- Use `import ... from "rules-engine"`; imports de arquivos internos não são exportados.
- Atualizações administrativas agora exigem token, inclusive localmente.
- Comparações de ausência foram preservadas; a documentação anterior estava incorreta.
  Considere `actualState` ao interpretar traces serializados e compare objetos por
  campos escalares quando precisar igualdade de conteúdo.
- Cópias internas e públicas custam memória e processamento. A ordenação ocorre
  uma vez por versão; não há alegação de ganho percentual sem benchmark.

## Próximos passos possíveis (fora do escopo desta primeira versão)

- Persistir o histórico de versões em disco/banco (hoje vive em memória, por engine).
- Watch de arquivo (`fs.watch`) para hot-reload automático a partir de um JSON em disco.
- Um segundo tipo de "value" dinâmico (ex.: `{ "field": "b" }` para comparar dois campos entre si).
- Motor de conflito mais rico entre ações do mesmo tipo (hoje quem resolve é o consumidor da lista de `actions`).
