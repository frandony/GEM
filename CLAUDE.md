# CLAUDE.md — App Estudo + Treino

Contexto de trabalho para retomar o projeto em uma sessão nova.
Os documentos de produto (`00_PLANO.md` … `06_schema_v1.sql`) são a **fonte da
verdade do que construir**. Este arquivo registra **o que já foi construído,
como rodar, e as decisões tomadas durante a implementação**.

---

## 1. Estado atual

**Backend completo e em produção. Frontend completo e no ar em
https://www.megs.digital** (Vercel, PWA instalável).

```
├── 00_PLANO.md … 06_schema_v1.sql   ← specs de produto (não editar sem pedir)
├── CLAUDE.md                        ← este arquivo
├── scripts/
│   ├── gerar-seed.mjs               ← CSV → seed.sql (valida enums, falha cedo)
│   └── gerar-icones.mjs             ← PNGs do PWA a partir dos tokens de cor
├── supabase/
│   ├── config.toml
│   ├── seed.sql                     ← 163 exercícios (GERADO — não editar à mão)
│   ├── migrations/                  ← 18 arquivos, ordem numérica
│   └── functions/
│       ├── _shared/{cors,supabase,llm,catalogo}.ts
│       ├── montar-treino/{index,validacao,fallback}.ts
│       ├── montar-estudo/  extrair-topicos/
│       ├── disparar-notificacoes/   diagnostico-ia/
└── app/                             ← front React + Vite (PWA)
    ├── vercel.json                  ← rewrite de SPA — ver NOTAS-DEPLOY.md
    ├── public/icones/               ← GERADOS por scripts/gerar-icones.mjs
    └── src/
        ├── lib/{supabase,auth,dados,fila,progressao,montarTreino}.ts
        └── telas/{Login,AuthCallback,Onboarding,Home,Treino,
                   EditarPlano,SessaoTreino,Estudo,Grupo}.tsx
```

### Pronto

| Item | Onde |
|---|---|
| Schema completo (enums, catálogo, treino, estudo, streak, feed, push) | `migrations/01`–`10` |
| RLS em **todas** as tabelas + GRANTs da Data API | `migrations/11` |
| Agregados do feed por trigger (`resumos_diarios`) | `migrations/12` |
| RPCs de domínio (rotação, progressão dupla, streak, ênfase, grupo) | `migrations/13` |
| pg_cron (push, inatividade, fechamento semanal, lembretes) | `migrations/14` |
| Gravação atômica do plano (`salvar_programa`) | `migrations/15` |
| Seed do catálogo | `seed.sql` |
| Edge Function `montar-treino` (Prompt 1 completo) | `functions/montar-treino/` |

| Edge Function `montar-estudo` (Fases A e B + cálculo do ideal) | `functions/montar-estudo/` |
| Edge Function `extrair-topicos` (Prompt 3) | `functions/extrair-topicos/` |
| Edge Function `disparar-notificacoes` (Web Push VAPID) | `functions/disparar-notificacoes/` |
| `deno.json`, `.env.example`, `.gitignore`, `package.json` | raiz e `functions/` |

**Backend completo: ~3.200 linhas de SQL, ~2.400 de TypeScript.**

### Validado contra um banco de verdade ✅

Projeto Supabase **`app-estudo-treino`** — ref `labkfsakestwjxmcmirj`, região
`sa-east-1`, Postgres 17, free tier. As 17 migrations foram aplicadas, o seed
rodou, e os testes abaixo passaram com dois usuários reais:

| Teste | Resultado |
|---|---|
| 17 migrations aplicadas em ordem | sem erro |
| Seed do catálogo | 163 exercícios |
| Trigger `handle_new_user` | perfil criado com o nome do metadata |
| `salvar_programa` (gravação atômica) | 1 programa + 3 sessões + 5 exercícios + substitutos |
| **Isolamento de RLS** | Bruno vê 0 programas / 0 sessões / 0 exercícios da Ana |
| Policies em cascata | sessão filtrada pelo dono do *programa*, sem coluna própria |
| Grupo (`criar_grupo` → `entrar_no_grupo`) | Bruno passa a ver o **plano** da Ana |
| Privacidade dentro do grupo | Bruno segue vendo **0** de `treino_sessoes` e `semanas_resumo` |
| Recursão de `grupo_membros` (42P17) | não ocorre — `grupos_do_usuario()` resolve |
| Rotação da fila | `finalizar_treino` avançou A → B |
| Trigger de agregado | `resumos_diarios` preenchido sozinho |
| **Progressão dupla** | 60 kg batendo `reps_max` nas 4 séries → sugeriu **62,5 kg** |
| Peso corporal | Flexão de braço → `progride_por: reps`, sem carga |
| `volume_por_grupo` / `proporcao_enfase` | somas corretas por grupo e região |
| Vidas | faltaram 2 dos 3 treinos → gastou exatamente 2 vidas |
| **Streak com semana off** | 3 (a semana off congelou: não somou, não quebrou) |
| `net.http_post` (caminho do cron) | assinatura resolve, requisição enfileirada |
| pg_cron | 6 jobs agendados |
| Exclusão de conta | cascade limpo, zero resíduo |

### Edge Functions — testadas com requisição real

Deploy pela MCP do Supabase e chamadas por `curl` com JWT de usuário real
(signup → confirmação → login):

| Teste | Resultado |
|---|---|
| Compilação da cadeia inteira (7 arquivos, ~1.300 linhas) | deploy `ACTIVE` |
| `disparar-notificacoes` sem `x-cron-secret` | 401 ✓ |
| ... com segredo errado, e em GET | 401 ✓ |
| `montar-treino` sem JWT | 401 ✓ |
| Preflight CORS | 204 ✓ |
| Divisão inválida / frequência fora da faixa | 400 com mensagem ✓ |
| Requisição válida (sem IA configurada) | 200 em 1,1 s, caiu no fallback ✓ |
| Gravação via `salvar_programa` | 3 sessões, 14 exercícios, 40 substitutos ✓ |
| `origem_fallback`, `dias_lembrete`, `hora_lembrete`, fila em A | corretos ✓ |
| Trigger `handle_new_user` no signup **real** | perfil criado com o nome do metadata ✓ |

**Pendência de deploy:** o `montar-treino` no servidor ainda tem a versão
anterior do `fallback.ts` (bug abaixo). Corrigir no próximo `npm run fn:deploy`.
Existe também uma função temporária **`fallback-probe`** no projeto, usada só
para verificar a correção — **apagar**.

### Três problemas achados rodando (já corrigidos)

0. **`montar-treino/fallback.ts` — duas definições de "composto".**
   A validação usava a lista `PADROES_COMPOSTOS`; o template de fallback usava
   o palpite `!padrao_movimento.startsWith("isolamento")`. Cinco padrões caíam
   no lado errado — `panturrilha`, `flexão de tronco`, `antiextensão`,
   `rotação`, `extensão de tronco` — e viravam 4×6-10 com 120 s de descanso
   quando o spec pede complemento (3×10-15, 60 s). Na prática: abdômen e
   panturrilha saíam com carga de exercício composto.
   **Lição:** duas definições da mesma regra no mesmo código é bug esperando
   acontecer. Agora `PADROES_COMPOSTOS` é fonte única.

1. **`migrations/17`** — apagar a conta era impossível. O cascade removia
   `profiles`, depois `treino_sessoes`; o trigger `AFTER DELETE` chamava
   `recalcular_dia()`, que tentava gravar em `resumos_diarios` com um
   `user_id` que já não existia → violação de FK → o DELETE inteiro revertia.
   **Lição:** todo trigger `AFTER DELETE` que escreve em outra tabela precisa
   tolerar o pai já ter sumido.
2. **`migrations/16`** — a FK `series_registros.exercicio_id` estava sem índice
   de cobertura. Eu tinha assumido que o índice composto de progressão
   `(user_id, exercicio_id, registrada_em)` servia; não serve — índice
   composto só cobre busca que começa pela primeira coluna.

### Advisors — analisados, não silenciados

`security`: 4 WARN, 0 ERROR.
- `extension_in_public` em **pg_net**: verificado, **falso positivo aqui**. Os
  15 objetos da extensão vivem no schema `net`, nenhum em `public`, e `net`
  não está em `[api].schemas`. A extensão não é relocável (`SET SCHEMA` dá
  erro), então mexer nisso é risco sem ganho.
- 3× `SECURITY DEFINER` executável por `authenticated`
  (`criar_grupo`, `entrar_no_grupo`, `streak_de`): **intencionais e
  necessários** — sem DEFINER, quem não é membro não resolve o código de
  convite, e o streak do grupo não é legível. Cada um checa `auth.uid()` (ou
  `private.pode_ver`) na primeira linha do corpo.

`performance`: 1 achado real (corrigido em `migrations/16`). O resto é
`unused_index` em banco recém-criado, onde nenhuma query rodou ainda — ruído,
não achado. **Reavaliar depois de semanas de uso real**, aí sim vale podar.

### Falta

- [x] ~~`deno check`~~ — Deno 2.9.5 instalado em `~/.deno/bin`. As 5 funções
      passam em `deno check` e `deno lint` (`npm run fn:check`). Antes de
      mexer nelas, **rode isso**: a primeira execução achou 3 erros de tipo
      que teriam ido quebradas para produção.
- [ ] Popular `private.config` com `projeto_url` e `cron_secret` (o push fica
      em silêncio até isso existir — de propósito)
- [ ] UI de push/service worker de notificação no cliente
- [ ] `extrair-topicos` não tem tela: Estudo só cria matéria manualmente
- [ ] Feed e revisão semanal não têm tela
- [ ] Nenhum teste automatizado — só `tsc --noEmit` e `vite build`

---

## 1a. Wall clock — por que "Edge Function returned a non-2xx status code"

Sintoma em produção (2026-08-13, ao montar um plano): o front mostrava só a
mensagem genérica do supabase-js. Não havia corpo de erro para
`extrairErroDeFuncao` desembrulhar **porque não havia resposta nenhuma**.

Os logs contam a história inteira:

```
01:29:08  booted
01:30:20  WARN  gemini-3.5-flash indisponível (503 "high demand")
                — tentando nvidia/nemotron-3-super-120b-a12b:free
01:31:38  shutdown  reason: WallClockTime     ← 150s exatos
```

O runtime mata a função aos **150s** (plano free). O provedor primário
demorou 72s para devolver 503; o fallback então começou com os 120s dele
(72 + 120 = 192s) e a função morreu no meio. Nem o 503 de
`ProvedorIndisponivel` nem o template de fallback chegaram a rodar.

**A correção é orçamento de tempo da requisição, não timeout por chamada.**
`_shared/llm.ts` ganhou `prazoFinal` (epoch ms), propagado até o `fetch` e
até o SDK da Anthropic. Três regras:

1. Cada tentativa recebe **o que sobrou**, não 120s fixos.
2. Quem não cabe no que sobrou (`MINIMO_UTIL_MS`, 15s) **não começa** —
   melhor um 503 explicado que um processo morto.
3. Havendo reserva configurada, o primário usa no máximo
   `FATIA_DO_PRIMARIO` (55%) do prazo. Sem esse teto a reserva é
   decorativa: era o caso, o primário consumia quase tudo antes de falhar.

O orçamento (`LLM_ORCAMENTO_MS`, padrão 110s) é menor que o wall clock de
propósito — a diferença é a reserva para gravar o template e responder.

Detalhe semântico que vale manter: se a geração for inválida e não sobrar
tempo para o retry, o erro lançado é `Error` comum e **não**
`ProvedorIndisponivel`. O modelo respondeu, só respondeu errado — isso é
"geração ruim", que grava o template, e não "provedor fora do ar", que
devolve 503 sem gravar nada.

---

## 1b. Autenticação — a pegadinha do domínio próprio

Depois da troca para `megs.digital`, confirmar conta parou de funcionar.
Eram **duas** causas somadas, e nenhuma aparecia no console do navegador:

1. **`emailRedirectTo` nunca era enviado.** Sem ele, o link do e-mail aponta
   para o *Site URL* do projeto — que continuou sendo o endereço antigo.
   Corrigido em `app/src/lib/supabase.ts` (`urlDeRetornoDeAuth()`).
2. **A Vercel devolvia 404 de verdade em qualquer rota do SPA.** Medido:
   `/treino`, `/auth/callback` e `/rota-inexistente` respondiam 404
   `text/plain`. Passou meses despercebido porque **o service worker do PWA
   servia o `index.html` do cache** para quem já tinha o app aberto. O link
   do e-mail abre no navegador do app de e-mail, sem service worker — e
   batia na 404. Corrigido por `app/vercel.json` (ver `app/NOTAS-DEPLOY.md`).

**O que ainda depende do painel do Supabase** (não dá para fazer por
migration nem por MCP — `db push` não toca em config de Auth):

> Authentication → URL Configuration
> - **Site URL:** `https://www.megs.digital`
> - **Redirect URLs:** `https://www.megs.digital/auth/callback`,
>   `https://megs.digital/auth/callback`,
>   `http://localhost:5173/auth/callback`

Sem isso o Supabase **ignora o `emailRedirectTo` em silêncio** e usa o Site
URL. `supabase/config.toml` já tem os mesmos valores, mas ele configura o
stack **local**; só `supabase config push` sincroniza com a nuvem.

**Não existe 2FA/MFA neste app** — `auth.mfa_factors` está vazio e não há
código de MFA. O que era chamado de "autenticação de dois fatores" é a
confirmação de conta por e-mail, que é o que foi corrigido.

**Fluxo escolhido: `implicit`, não `pkce`** (explícito em `supabase.ts`). No
PKCE o verificador fica no localStorage do navegador que pediu o cadastro:
quem se cadastra no celular e abre o e-mail no notebook trava em "code
verifier missing". Implícito funciona entre aparelhos.

---

## 2. Ambiente desta máquina

| Ferramenta | Situação |
|---|---|
| Node | v24.18.0 ✅ |
| Supabase CLI | **não instalado** |
| Docker | **não instalado** |
| Deno | **não instalado** |
| `claude` CLI | não está no PATH — usar o binário do VS Code (abaixo) |

```powershell
# O `claude` do PATH não existe; o da extensão do VS Code existe:
$c = "C:\Users\rgama\.vscode\extensions\anthropic.claude-code-2.1.224-win32-x64\resources\native-binary\claude.exe"
& $c plugin list
```

**Sem Docker, o stack local do Supabase (`supabase start`) não roda.** Dois
caminhos:

1. **Recomendado agora:** criar um projeto no Supabase Cloud (free tier) e usar
   `supabase link` + `supabase db push`. Edge Functions deployam **sem Docker**
   com `--use-api`.
2. Instalar Docker Desktop se quiser o ciclo local completo.

### Instalar o que falta

```powershell
npm install -g supabase        # ou: scoop install supabase
irm https://deno.land/install.ps1 | iex
```

### Repositório git — resolvido

Repositório próprio na pasta do projeto, remoto `github.com/frandony/GEM`,
branch `main`. (Uma versão antiga deste arquivo dizia que o repo tinha sido
inicializado na pasta pessoal — não é mais o caso.)

---

## 3. Skills instaladas

```powershell
& $c plugin marketplace add supabase/agent-skills
& $c plugin install supabase@supabase-agent-skills --scope project
& $c plugin install postgres-best-practices@supabase-agent-skills --scope project
```

Escopo `project` → gravado em `.claude/settings.json` deste diretório.
Ambas carregadas e aplicadas ao schema. A skill `claude-api` (built-in) foi
usada para as Edge Functions.

---

## 4. Como rodar

```powershell
supabase link --project-ref <ref>
supabase db push                        # aplica migrations/ em ordem
supabase db reset --linked              # CUIDADO: apaga tudo e reaplica + seed

# Edge Functions — sem Docker
npm run fn:deploy    # deploy das quatro com --use-api

# Segredos das funções (ver .env.example para o que é cada um)
npm run vapid        # gera o par VAPID uma vez
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set ORIGENS_PERMITIDAS=https://seu-app.vercel.app
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:voce@exemplo.com
supabase secrets set CRON_SECRET=<mesmo valor que vai em private.config>

# Checagem local (exige Deno)
npm run fn:check
```

### Passo obrigatório depois do deploy — o cron não funciona sem isto

```sql
insert into private.config (chave, valor) values
  ('projeto_url', 'https://<ref>.supabase.co'),
  ('cron_secret',  '<segredo forte e aleatório>');
```

`private.disparar_fila_push()` sai em silêncio enquanto essas chaves não
existirem — de propósito: o app funciona sem push. O mesmo `cron_secret` vai
no header `x-cron-secret` que a função `disparar-notificacoes` confere.

### Regerar o seed depois de mexer no CSV

```powershell
node scripts/gerar-seed.mjs
```

O script valida cada valor contra os enums e **falha antes de escrever** se o
CSV divergir do schema.

### Frontend

```powershell
cd app
npm ci
npm run dev            # http://localhost:5173 — exige app/.env preenchido
npm run lint           # tsc --noEmit
npm run build          # tsc -b && vite build
node ../scripts/gerar-icones.mjs   # regera app/public/icones/ dos tokens
```

Deploy é automático pela Vercel no push para `main`. O **Root Directory** do
projeto na Vercel precisa ser `app` — senão o `vercel.json` não é lido e as
rotas voltam a dar 404.

---

## 5. Decisões tomadas na implementação

Coisas que **não** estão nos specs e que foram decididas ao escrever o código.

### Mudanças forçadas por breaking changes do Supabase

- **Desde 2026-04-28, tabelas novas em `public` não são expostas à Data API
  automaticamente.** Todo `GRANT` é explícito em `migrations/11`. Sem isso o
  app toma `permission denied` mesmo com a policy certa. Tabela nova = adicionar
  na lista de GRANT.
- `[api].auto_expose_new_tables` **não** é setado no `config.toml`, de propósito
  (o campo é deprecado e some em 2026-10-30).

### RLS — o schema original estava incompleto

`06_schema_v1.sql` liga RLS em 27 tabelas mas escreve ~10 policies. Tabela com
RLS ligada e **sem** policy = ninguém lê nada. Todas ganharam policy explícita.

Três regras aplicadas em toda policy:
1. `to authenticated` sempre (nunca `auth.role()`, que é deprecado e quebra com
   login anônimo).
2. `(select auth.uid())` com subselect — o Postgres avalia uma vez (initplan)
   em vez de uma vez por linha.
3. `UPDATE` precisa de `USING` **e** `WITH CHECK` — sem `WITH CHECK` o usuário
   reatribui a própria linha para outra pessoa.

**`private.grupos_do_usuario()` é `SECURITY DEFINER` por necessidade, não por
conveniência:** sem ela, a policy de `grupo_membros` consultaria
`grupo_membros` e entraria em recursão infinita (erro 42P17).

### Divergências deliberadas do `06_schema_v1.sql`

| Mudança | Motivo |
|---|---|
| `series_registros.user_id` desnormalizado | a sugestão de carga é "última carga deste exercício **pra mim**"; sem a coluna o índice devolve dado de outra pessoa. Coerência garantida por trigger. |
| `semanas_resumo` **privada**, streak via RPC `streak_de()` | a linha carrega `usou_vida`, e vida é privada. O grupo lê só o número. |
| `equipamentos_indisponiveis` por **equipamento** (não por exercício) | ponto aberto §12 do plano. 7 valores de enum contra 163 exercícios — marcar item a item é onboarding que ninguém termina. |
| Tabela `plano_alteracoes` (nova) | o "desfazer" da troca permanente precisa sobreviver a um reload; também é coleta do dia 1 (§10). |
| Tabela `avisos_silenciados` (nova) | caso-limite 1 do estudo exige "não repete por 2 semanas". |
| `treino_sessoes.sessao_letra/nome` congelados | se o plano for refeito, o histórico ainda diz "isto foi o treino B". |
| `motivo_atrapalho` virou enum | o spec já pedia opções fixas; enum torna a série temporal limpa por construção. |
| pgcrypto removido | `gen_random_uuid()` é core desde o PG13 e o projeto roda 17. |

### Edge Functions

- **Provedor de IA é configurável por função** (`_shared/llm.ts`). Dois
  caminhos: `anthropic` (nativo — schema garantido pela API + prompt caching
  do catálogo) e `openai-compat` (OpenRouter, OmniRoute auto-hospedado,
  Together, LM Studio). Escolha por env, sem tocar em código:
  `LLM_<TAREFA>_PROVEDOR` / `_MODELO` / `_BASE_URL` / `_API_KEY`.
  Tarefas: `MONTAR_TREINO`, `MONTAR_ESTUDO_FASE_A`, `MONTAR_ESTUDO_FASE_B`,
  `EXTRAIR_TOPICOS`.
- **A garantia de schema não é igual nos dois caminhos.** Na Anthropic a API
  garante. Em endpoints compatíveis, a doc do OpenRouter é explícita: alguns
  provedores garantem, outros tratam o schema como "dica forte". Por isso o
  caminho compat limpa cerca de ```json e valida o parse antes de devolver —
  no caminho Anthropic isso seria redundante.
- **Decisão do usuário: OmniRoute auto-hospedado, custo zero.** Ele já mantém
  uma instância para outro projeto. Não existe OmniRoute hospedado (*"there is
  no OmniRoute cloud in the request path"*), então a `LLM_BASE_URL` precisa ser
  o endereço **público** da instância dele — `localhost` não funciona, porque a
  Edge Function roda na infraestrutura do Supabase.
- **`ProvedorIndisponivel` existe por causa dessa escolha.** Erro de conexão,
  timeout, 5xx e 429 são separados de erro de geração:
  - geração inválida → **cai no template** (melhor genérico que nada)
  - provedor fora do ar → **503, não grava nada** (o plano bom ainda existe do
    outro lado; salvar um template condenaria a pessoa a um plano pior por
    causa de um reboot)

  Sem essa distinção, um deploy do OmniRoute durante o onboarding de alguém
  gravaria um template genérico em silêncio. `extrair-topicos` não precisa
  disso: já devolve 502 e nunca grava (`gravado: false`).

#### Três adaptações que o modelo do OmniRoute exigiu

O OmniRoute agrega **43 pools de free tier (~1,53B tokens/mês)** com
capacidade muito desigual. O código no caminho `openai-compat` trata isso:

1. **Degradação de `response_format`.** Tenta com `json_schema`; se o provedor
   reclamar do parâmetro (400 citando `response_format`/`schema`/`not
   support`), repete **sem ele** e com o schema em prosa no system. Sem isso,
   um provedor mais fraco na cascata derruba a geração inteira.
2. **Reparo de JSON.** Se o parse falhar, uma chamada extra devolve o texto
   quebrado pedindo só o objeto de volta. Modelo free costuma embrulhar em
   ` ```json `, escrever "Aqui está o plano:" antes, ou deixar vírgula
   sobrando. `extrairJson()` também recorta do primeiro `{` ao último `}`.
3. **`diagnostico-ia`.** Edge Function que testa o provedor com três provas de
   dificuldade crescente — vivo → schema aninhado com campo nulo → catálogo
   inteiro com restrição cruzada, validado contra o banco. Não grava nada.
   O veredito diz se o modelo serve para `montar-treino` ou só para as
   tarefas simples.

  **Rode o `diagnostico-ia` antes de confiar num modelo novo.** "Responde" não
  é a mesma coisa que "serve para montar treino": a prova 3 é a que separa as
  duas, e ela pega alucinação de id e filtro ignorado.

  Quando o schema nativo não é usado, o log avisa
  (`rodou SEM schema nativo`) — aí a validação de domínio é a única rede.
- **`output_config.format` (structured outputs) substitui "devolva SOMENTE JSON
  válido".** A API garante o formato. Isso aposenta o retry por falha de parse
  dos specs; o retry que sobrou é só para violação de **regra de domínio**.
- **Prompt caching no catálogo.** Ordem de renderização é `tools → system →
  messages`, e cache é casamento de **prefixo**. Por isso: regras + catálogo no
  `system` (com o breakpoint no fim do catálogo), e tudo que varia por usuário
  (frequência, ênfase, curtidos) no `messages`. Interpolar qualquer coisa
  volátil no `system` mata o cache — verificar `cache_read_input_tokens` na
  resposta se desconfiar.
- **Modelo: `claude-opus-5`.** Sem `temperature` (o parâmetro foi removido
  nessa geração e devolve 400). `effort: "xhigh"` no montar-treino: roda uma
  vez no onboarding e é a decisão mais importante do fluxo.
- **`stop_reason: "refusal"` é checado antes de ler `content`** — numa recusa o
  `content` vem vazio e `content[0]` estouraria.
- **O catálogo é filtrado por equipamento ANTES de virar prompt.** O que não
  está no catálogo não pode ser escolhido; a validação 8 vira defesa em
  profundidade em vez de linha de frente.
- **O template de fallback escolhe por (grupo, padrão), não por id fixo** — assim
  continua funcionando para quem marcou equipamentos como indisponíveis, que é
  justamente quem tem mais chance de ver a geração falhar.

### Riscos confirmados pelo gerador de seed

O script contou os exercícios por padrão de movimento e confirmou o §14 do
plano, com um a mais que o documento não listava:

```
 1  carregamento
 3  isolamento de antebraço
 3  isolamento de costas
 4  rotação
 4  extensão de tronco      ← não estava no §14
```

Nesses padrões o fallback de substitutos devolve lista curta ou vazia. Não é
bug: é o catálogo. Ou entram mais exercícios, ou esses padrões praticamente
não vão ser escolhidos.

Também: `comum=1: 61 · comum=2: 63 · comum=3: 39`, 32 unilaterais, 31 sem
`incremento_kg` (progridem por reps).

---

## 6. Convenções

- **Tudo em português** — schema, funções, variáveis, comentários. Os enums têm
  acento (`bíceps`, `máquina`, `flexão de tronco`) e batem 1:1 com o CSV e com
  os prompts. Mudar um exige mudar seed + prompts + validação junto.
- **Datas de calendário são `date` no fuso do usuário** (`profiles.timezone`);
  instantes são `timestamptz`. Nunca misturar.
- **Ids de conteúdo do usuário são uuid gerados no cliente** (offline-first) —
  o upsert vira idempotente e a fila local reenvia sem duplicar. O catálogo é
  a exceção: `serial`, porque é dado global.
- **Toda função tem `set search_path = ''`** e qualifica tudo com schema.
- **`private` não está em `[api].schemas`** → o PostgREST não expõe nada de lá.
  É o que permite usar `SECURITY DEFINER` sem criar endpoint público sem querer.
- Migrations são imutáveis depois de aplicadas: para mudar, criar outra com
  `supabase migration new <nome>`.

---

## 7. Ordem de construção (do §11 do plano)

1. ~~Teste da Opção 1 (push como timer)~~ — independente, roda em paralelo
2. ~~Migration + seed~~ ✅
3. Auth + perfil + grupo — schema pronto, **falta o cliente**
4. **Registro de treino offline-first** ← próximo item crítico do front
5. ~~Motor de treino~~ ✅ backend
6. Timer em primeiro plano
7. Estudo (Prompts 2 e 3) — **backend pendente**
8. Push + pg_cron — SQL pronto, **falta a Edge Function**
9. Feed
10. Revisão semanal

Itens 4 e 5 decidem se o app é usado de verdade.

---

## 8. Edição do plano de treino (front)

`app/src/telas/EditarPlano.tsx`, alcançável por "Meu plano" na tela de Treino.
Antes disso o plano ficava **congelado para sempre** depois do onboarding: a
tela de montar treino só aparecia para quem *não* tinha plano.

Três operações por exercício — ajustar (séries/reps/descanso), trocar
(`substitutos_do_exercicio`: 3 da IA + catálogo do mesmo grupo e padrão) e
remover — mais excluir o plano inteiro.

**Nenhuma RPC nova.** A RLS já dá UPDATE/DELETE ao dono, e as invariantes
são CHECK e UNIQUE do schema (`ck_reps_xor_tempo`, `series between 1 and 10`,
`unique (sessao_id, exercicio_id)`). Reescrever essas regras numa RPC seria
a segunda definição da mesma coisa — o erro que já custou caro no
`fallback.ts`. O cliente traduz `23505` e `23514` para português e valida
antes de enviar, mas o banco continua sendo a autoridade.

**Excluir o plano não apaga histórico.** Verificado contra o banco real, com
DELETE dentro de bloco revertido: `treino_sessoes` 12 → 12,
`series_registros` 98 → 98, `sessoes` 6 → 3. As execuções que apontavam para
as sessões apagadas ficam com `sessao_id` nulo (`on delete set null`) e
seguem legíveis pela letra e nome congelados na própria linha. Streak e
grupo não são afetados.

---

## 9. Ao retomar

1. Ler este arquivo e `00_PLANO.md`.
2. Conferir o que falta na seção 1.
3. Antes de mexer em SQL, carregar a skill `postgres-best-practices`; antes de
   mexer em Edge Function que chama IA, carregar `claude-api`.
4. Migrations e Edge Functions **já rodaram contra o banco de produção**
   (`labkfsakestwjxmcmirj`). Migration nova = `supabase migration new`, nunca
   editar uma já aplicada.
5. Para mexer no front, `cd app && npm ci` primeiro — `node_modules` não é
   commitado e o `tsc` não roda sem ele.
