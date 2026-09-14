# Entrega e verificação — 14/09/2026

## Resultado

Implementação na branch `fix/rules-engine-integrity`, sem dependências de runtime.
A suíte passou de 36 para **122 testes**, preservando os 36 testes originais.

| Comando | Node 22.0.0 / npm 10.7.0 | Node 24.18.1 / npm 11.16.0 |
| --- | --- | --- |
| `npm run build` | Sucesso; saída limpa e JSONs copiados | Sucesso; saída limpa e JSONs copiados |
| `npm test` | 122 passaram; 0 falhas | 122 passaram; 0 falhas |
| `npm run test:dist` | 122 passaram; 0 falhas | 122 passaram; 0 falhas |
| `npm run demo` | 16 cenários, rejeição de atualização e rollback | 16 cenários, rejeição de atualização e rollback |
| `npm run demo:dist` | Mesmas verificações, com JavaScript compilado | Mesmas verificações, com JavaScript compilado |
| `npm run test:package` | ESM, tipos NodeNext, demo e HTTP aprovados | ESM, tipos NodeNext, demo e HTTP aprovados |

Todos esses comandos foram executados, com código de saída zero. O teste de
empacotamento executa `npm pack`, instala o tarball em diretório temporário,
verifica os 22 arquivos distribuídos e a ausência de dependências de runtime.
Também cria uma sentinela em `dist` e confirma sua remoção pelo build do `prepack`.
Não houve publicação no registro.

O consumo temporário resolve tipos usando o TypeScript 5.9.3 instalado no projeto,
com `--noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022`.
Os servidores compilado e instalado usam portas temporárias e terminam por SIGTERM.
A integração HTTP inclui oito testes, executados nas suítes fonte e compilada:
autenticação, contratos, atualização/rollback, erros 500 sem detalhes internos,
limite inclusivo em bytes, corpo chunked excessivo, interrupção e erro de leitura.

## Comandos de reprodução

No Node padrão do ambiente (24.18.1):

```bash
npm run build
npm test
npm run test:dist
npm run demo
npm run demo:dist
npm run test:package
```

Para a matriz mínima foi usado `npm exec` com Node 22.0.0 e npm 10.7.0 no PATH,
executando a mesma sequência. Cada comando pode ser repetido assim:

```bash
npm exec --yes --package=node@22.0.0 --package=npm@10.7.0 -- npm run build
npm exec --yes --package=node@22.0.0 --package=npm@10.7.0 -- npm test
npm exec --yes --package=node@22.0.0 --package=npm@10.7.0 -- npm run test:dist
npm exec --yes --package=node@22.0.0 --package=npm@10.7.0 -- npm run demo
npm exec --yes --package=node@22.0.0 --package=npm@10.7.0 -- npm run demo:dist
npm exec --yes --package=node@22.0.0 --package=npm@10.7.0 -- npm run test:package
```

Também foram executados `tsc -p tsconfig.json --noEmit`, testes focados durante
cada etapa, `git diff --check` e comparação da alteração local de `.gitignore`
com sua cópia anterior ao trabalho. O lockfile foi atualizado com
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund`;
a única mudança em relação ao lockfile fornecido foi `engines.node` na raiz.

## Problemas reproduzidos antes das correções

- 36 testes passavam nos dois Nodes, sem cobrir os problemas relatados.
- Mutar entrada, retorno do carregamento, regras, ações, `trace.expected` ou
  `loadedAt` alterava o estado observado do motor. `trace.actual` alterava fatos.
- `gte` com string, params/description numéricos, prioridade infinita e `enabld`
  passavam na validação. Condição cíclica causava `RangeError` por estouro da pilha.
- `getByPath({}, "constructor")` retornava `Object`; dados herdados eram lidos.
- Ausência atendia `ne`, `notIn` e `not(eq)`, contradizendo o README.
- Compilação em pasta nova passava; a entrada declarada gerava
  `ERR_MODULE_NOT_FOUND`, e ambos os exemplos compilados falhavam com `ENOENT`
  pela falta dos JSONs.
- HTTP retornava 500 para JSON malformado e rollback inexistente, 200 para fatos
  `null`/arrays e 201 para carregamento administrativo sem credenciais.

Rejeição de versão duplicada, proteção parcial da atualização inválida e rollback
já existiam. Foram preservados e receberam regressões mais abrangentes.

## Correções, decisões e compatibilidade

- Versões usam cópias internas congeladas; retornos e traces são cópias mutáveis
  independentes. Datas internas são timestamps. Falhas preservam todo o histórico.
- Validação usa domínio JSON nas regras, JSON mais `undefined` nos fatos,
  propriedades próprias, rejeição de chaves desconhecidas no schema e limites
  explícitos de profundidade, regras, condições e valores visitados.
- Comparações existentes foram preservadas; presença explícita fica na regra de
  negócio. `actualState` diferencia ausência, `undefined`, `null` e valor em JSON.
- Caminhos leem apenas propriedades próprias de dados e recusam segmentos vazios
  ou reservados. O achado corrigido é leitura indevida de propriedades herdadas.
- A ordenação é preparada uma vez por versão, com desempate original e modos
  preservados. Traces e `explain` continuam completos. Não foi feito benchmark,
  e não há alegação de ganho percentual.
- Administração HTTP exige token e o executável escuta apenas no loopback.
  Corpos inválidos não ativam versões; erros esperados têm códigos específicos.
- O ID do exemplo mudou de `frete-gratis-sudeste` para
  `frete-gratis-regioes-elegiveis`. Consumidores que usavam o ID devem atualizá-lo.
- Objetos em condições continuam comparados por identidade, mas versões copiadas
  não compartilham identidade com a entrada original. Para conteúdo, compare
  campos escalares. `getByPath` permanece um helper com referência emprestada;
  o trace tem cópia própria.
- O pacote exige Node >=22.0.0 e sua entrada pública é ESM. Imports internos,
  dados especiais e configurações antes aceitas indevidamente podem ser rejeitados.

## Arquivos alterados ou acrescentados

- Núcleo: `src/types.ts`, `src/index.ts`, `src/validation.ts`, `src/conditions.ts`,
  `src/engine.ts`; novos `src/data.ts` e `src/paths.ts`.
- Exemplos: `examples/demo.ts`, `examples/server.ts`,
  `examples/rules-frete-desconto.v1.json`, `examples/rules-frete-desconto.v2.json`.
- Regressões novas: `tests/validation-regression.test.ts`,
  `tests/conditions-regression.test.ts`, `tests/isolation.test.ts`,
  `tests/ordering.test.ts`, `tests/server.test.ts`, `tests/demo.test.ts`.
- Distribuição: `package.json`, `package-lock.json`, `scripts/build.mjs`,
  `scripts/verify-package.mjs`.
- Documentação: `README.md` e este `VERIFICATION.md`.

O README e o lockfile preexistentes, ainda não rastreados, foram incorporados
com as atualizações necessárias. A alteração preexistente em `.gitignore`
foi preservada byte a byte e ficou fora dos commits desta implementação.

## Limites da entrega

Nenhuma verificação do escopo ficou pendente. O histórico continua em memória,
o servidor é demonstrativo/local e a composição das ações pertence ao consumidor.
Somente Node 22.0.0 e 24.18.1 foram executados nesta revisão. O suporte é ESM;
não foi acrescentado empacotamento CommonJS.
