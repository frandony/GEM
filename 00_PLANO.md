# App Estudo + Treino — Plano completo v1

Documento mestre. Tudo que foi decidido, e onde está cada peça.

## Arquivos

| Arquivo | O que é | Quando usar |
|---|---|---|
| `00_PLANO.md` | este documento | contexto geral, decisões, ordem |
| `01_teste_opcao_1.md` | spec do teste de latência de push | **primeira coisa a construir** |
| `02_catalogo_exercicios.csv` | 163 exercícios classificados | seed do banco |
| `03_prompt_montar_treino.md` | geração do plano de treino | Edge Function |
| `04_prompt_montar_estudo.md` | geração do plano de estudo (2 fases) | Edge Function |
| `05_prompt_extrair_topicos.md` | extração de tópicos de PDF | Edge Function |
| `06_schema_v1.sql` | schema completo + RLS | migration inicial |

---

# 1. Premissa

App pessoal de estudo + academia, para uso próprio e da namorada. Serve também como
peça de portfólio, mas o diferencial vem de ser **produto real, usado no dia a dia** —
o que resolve o problema clássico de "mais um app de hábito genérico".

**O que diferencia:**

1. **Motor de treino programável** — montagem por IA, divisões flexíveis, substituição
   contextual, ênfase derivada de volume real, rotação. Quase nenhum app faz isso bem.
   É o problema de engenharia de verdade do projeto.
2. **Revisão semanal como fonte de contexto** — transforma dado morto (faltou terça) em
   contexto (faltou porque desanimou). Sem isso a IA só reagenda; com isso ela ajusta.
3. **Espaço compartilhado** — grupo fechado, progresso e plano visíveis entre os dois.

WhatsApp/Chatwoot ficou fora de propósito: isso já vive no histórico com clientes. Este
projeto prova outra coisa — **modelagem de domínio complexo + IA com estado**.

---

# 2. Plataforma

**PWA mobile-first: Vite + React + Supabase.**

SPA, não Next.js com SSR. Dois motivos: Capacitor exige build estático (mantém a porta
aberta sem retrabalho), e SSR não agrega nada num app atrás de login.

Custo zero — free tier de Vercel e Supabase. Caminho nativo descartado: exige Mac +
US$ 99/ano.

## Dois níveis de capacidade

iPhone (você) e Android (ela) não são iguais. Resolver com **detecção de recurso, nunca
detecção de sistema** — nada de `if (isIOS)` espalhado.

| | iPhone | Android |
|---|---|---|
| Timer com tela bloqueada | incerto (ver `01_teste`) | confiável |
| Aviso sem som | impossível (sem vibração) | vibração |
| Sync offline em background | não existe | automática |
| Instalação | manual, só Safari | prompt de um botão |
| Storage | pode ser limpo | persistente |

## Limitações do PWA que viram escopo

- **Onboarding de instalação** com print, específico pra Safari. Sem instalar, não há push.
- **Indicador de sincronização pendente** — não há background sync no iOS.
- **Destravar áudio no início da sessão** — Safari só toca som após gesto do usuário.
  O clique de "iniciar treino" toca um áudio inaudível e libera o contexto.
- **Aviso de tirar do mudo + botão de testar som** — nenhuma API detecta o interruptor
  de silencioso. Só dá pra pedir que a pessoa verifique. Completo na primeira sessão da
  semana, discreto nas demais.
- **Registro de série nunca falha por rede** — escrita otimista, fila local, sync depois.
  Mais importante que qualquer notificação.
- **Nada guardado só localmente.** Supabase é a fonte da verdade; a fila é buffer.

---

# 3. Motor de treino

## Fluxo de montagem

```
dias por semana → divisões possíveis (AB, ABC, ABCD, ABCDE)
   → escolha → ênfase (superior / inferior / equilibrado)
      → IA monta → estrutura editável
```

A IA entra uma vez, no onboarding, e sai do caminho. Não opina no dia a dia.

## O que a IA produz

JSON validado contra o catálogo. Por exercício: séries, reps (faixa min–max), descanso,
ordem e **3 substitutos pré-gerados** — salvos e invisíveis até tocar em "substituir".

Reps em faixa é o que fecha a progressão: **atingiu `reps_max` em todas as séries →
sugere subir a carga; senão repete.** Progressão dupla, o padrão real de academia.

## Substituição

**Contexto define permanência:**
- Durante a sessão → circunstancial, vive só no registro
- Fora da sessão → permanente, edita o molde

Funciona porque plano e execução são camadas separadas. **Editar o plano nunca reescreve
o passado.**

Três regras que acompanham:

1. **Desfazer sempre** — toast de "plano alterado · desfazer". A regra é implícita, então
   erro é inevitável.
2. **Repetição vira sinal** — trocou 3 das últimas 4 vezes → "quer tornar permanente?".
   Só contagem, sem IA.
3. **Fallback do catálogo** — os 3 da IA no topo, "ver mais" filtrando por grupo primário
   + padrão de movimento. Funciona offline. Cobre também o exercício que entrou por troca
   permanente e não tem substitutos próprios.

## Ênfase é derivada

Entra como parâmetro pra IA, mas **não é campo no banco**. É calculada somando séries por
grupo muscular no ciclo → vira tela real: *"peito 2x/18 séries, quadríceps 1x/9 séries"*.

Volume é métrica mais forte que frequência. E a mesma função valida a geração da IA
(checagem 11 do Prompt 1) e alimenta a tela — uma coisa, dois usos.

## Programa: rotação

Fila que avança a cada sessão registrada, não calendário fixo. Se furar a terça, o A não
se perde — acontece na quinta.

**Distinção crítica:** os dias planejados existem só para **agendar lembrete**. O
**conteúdo** vem da fila. Misturar as duas coisas é o que quebra a maioria dos apps.

Com ABC em 2 dias/semana o ciclo leva 3 semanas pra fechar — nenhuma semana se parece com
a anterior. Por isso a home precisa mostrar **"próximo: treino B"** com destaque.

## Progressão de carga

App sugere, usuário pode digitar. Regra:
- Repete a carga da última vez daquele exercício
- Completou `reps_max` em todas as séries → sugere um degrau acima
- Degrau vem de `incremento_kg` no catálogo (barra 2,5 · halter 2 · máquina 5 · polia 2,5)
- `incremento_kg` nulo (peso corporal, elástico) → progride por reps, não carga
- Primeira vez: campo vazio

Unilaterais: carga **por lado** (flag `unilateral` no catálogo).

## Sessão como máquina de estado

Iniciar o treino é **obrigatório**, não opcional — é o que define se uma substituição é
circunstancial. Estados: `em_andamento` → `concluida` | `abandonada`.

Encerramento automático por inatividade marca `abandonada` e registra em qual exercício
parou. Sem geolocalização: registrar uma série já é prova de presença, com 100% de
precisão e sem permissão nenhuma.

---

# 4. Motor de estudo

## Retroplanejamento

A lógica central: **conteúdo Y até o dia X, resolvido pra trás.** Não é agenda.

```
matérias + tópicos + datas
   → IA estima esforço por tópico (Fase A)
      → CÓDIGO calcula o ideal: "precisaria de 4 dias × 1h"
         → usuário escolhe o que consegue
            → IA distribui na grade real (Fase B)
```

**A aritmética não vai pra IA.** Ela erra conta e varia entre execuções, e esse número é
o que o usuário usa pra decidir. Precisa ser verificável.

Quando não cabe, o app **avisa antes** e oferece saídas explícitas: adicionar horários ·
priorizar tópicos · aceitar cobertura parcial · reduzir profundidade. Nunca gerar
silenciosamente um plano de 6h/dia.

"Saudável" é número configurável: máximo de blocos/dia, máximo de minutos/dia, um dia
leve por semana.

## Horário fixo

Grade fixa, para gerar disciplina. Ganho técnico: **replanejar vira redistribuir tópicos,
não remontar calendário.**

## Conteúdo

Três entradas: upload do plano de ensino (principal) · digitação manual (sempre
disponível) · IA a partir do nome da matéria (atalho, confiança sempre baixa).

Do PDF: **extrair tópicos, ignorar as datas.** Turma real atrasa; as datas que valem são
as confirmadas pelo usuário.

## Tipos de evento

| Tipo | Natureza | Tratamento |
|---|---|---|
| **Prova** | conteúdo a absorver | distribui tópicos, reserva revisão no fim |
| **Entrega** | coisa a produzir | marcos (pesquisar → escrever → revisar), último ≥1 dia antes |

Estudar 80% da matéria é resultado válido; entregar 80% do trabalho, não.

## Os sete casos-limite

1. **Bloco não terminado** — 1x: oferece retomar em versão resumida (bloco mais curto).
   Múltiplas vezes (sugestão: 3 em 7 dias): o app pergunta se está com dificuldade, e não
   repete por 2 semanas.
2. **Tópico não coberto** — reabsorvido no replanejamento. Enquanto isso fica marcado, com
   contador de "N tópicos aguardando replanejamento" na home.
3. **Múltiplas matérias** — intercalado, nunca mais de 2 blocos seguidos da mesma. Como
   intercalar dá menos sensação de progresso, o contador de cobertura por matéria compensa.
4. **Múltiplas datas por matéria** — matéria é container; prova/entrega são eventos dentro.
5. **Semana ruim** — replanejamento **sob demanda**, e vale só a partir da semana seguinte.
   A semana corrente fica estável. Ajuste na semana atual é manual.
6. **Dificuldade** — aluno marca fácil/médio/difícil no fim do bloco. Na v1 pesa no
   replanejamento (mais blocos, prioridade na revisão). Aprender com isso é v2.
7. **Semana off** — declarada com antecedência, não recebe blocos, não vira pendência.

## Mini-questionário

Sim/não ao fim de cada bloco. Duas ou três perguntas:
- **"Consegui focar?"**
- **"Entendi o conteúdo?"** ← o gatilho de reformulação
- **"Preciso revisar isso?"** ← marca o tópico pra revisão pré-prova

Mais a marcação fácil/médio/difícil.

**Não perguntar o que o app já sabe.** O timer sabe quanto tempo você ficou — pergunte só
o que ele não pode inferir.

**Privado**, fora do feed. Marcar "não entendi" tem custo emocional; enquadrar como
serviço ("quer que eu reserve tempo pra revisar?") funciona melhor que como avaliação.

---

# 5. Revisão semanal

Entra na v1 — não porque alguém usa o dado agora, mas porque **semana não coletada é
semana perdida pra sempre.** Quando a v2 chegar, você quer meses de histórico.

- **Resumo automático primeiro** — o app diz o que já sabe ("treinou 3 de 4, estudou 4h20
  de 6h") e você reage
- **Energia 1–5**
- **"O que atrapalhou?"** — opções **fixas** (tempo, cansaço, prova, desânimo, imprevisto,
  lesão) + campo livre opcional. Texto livre puro vira 6 meses de frases soltas pra IA
  interpretar; opção fixa vira série temporal limpa
- **"O que quer ajustar?"** — opcional
- Menos de um minuto. **Fácil de pular — e pular também é dado**
- **Privada por padrão**, com opção explícita de compartilhar

---

# 6. Streak

- **4 vidas por mês**, renovam no dia 1 → cobrem o **imprevisto** (gripe na quarta)
- **6 semanas off por semestre** (semestre fixo: janeiro e julho, contado pelo dia de
  início da semana) → cobrem o **previsível**
- **Semana off declarada até o domingo anterior.** Sem antecedência, toda semana vira off
- Semana off **congela**: não zera, não avança, não consome vida
- Conta por **frequência semanal**, não por dia específico — coerente com rotação
- Semana = segunda a domingo, mesmo ciclo da revisão semanal
- **Streak visível no feed, vidas privadas.** Streak é conquista; vida é vulnerabilidade
- Streak é **derivado**, nunca contador armazenado

---

# 7. Grupo e feed

- **Painel**, não timeline — os dois lado a lado, estado atual. Timeline de 2 pessoas fica
  esparsa; painel sempre parece cheio
- **Resumo diário** por pessoa, não evento a evento
- **Planos do dia lado a lado** — facilita combinar de treinar junto, sem feature nova
- **Reação simples** no resumo
- **Curtir exercício = preferência declarada**, não ação. A IA recebe os curtidos no
  prompt e prioriza. Guardar **quando** foi curtido (a v2 vai precisar dessa dimensão)
- **Zero push por atividade individual** — o feed é consultado, não persegue
- Grupo fechado por convite, **um só na v1**; estrutura suporta um terceiro depois

---

# 8. Onboarding

Somando tudo, o cadastro completo teria ~15 etapas. Isso é abandono garantido. Três
camadas:

**Camada 1 — entrar (30s):** conta, nome, "o que quer usar: treino, estudo ou os dois".

**Camada 2 — um módulo (3–5min):** configura só um. O outro fica como card de "configurar
depois" na home.

**Camada 3 — o resto, quando fizer sentido:** grupo, notificações, instalação.

## Ordem dentro de cada módulo

**Treino:** dias/semana → divisão → ênfase → dias → IA monta → revisa e ajusta.
Rápido porque a IA faz o trabalho pesado.

**Estudo:** matérias → conteúdo → datas → grade → IA mostra o ideal → escolhe → IA monta.
**Permitir começar com uma matéria só** — ver o resultado antes de pagar o custo total.

## O que fica pro fim, de propósito

- **Permissão de notificação** — pedir no primeiro segundo é o erro clássico. Depois do
  primeiro treino/bloco: *"quer ser avisado no próximo?"*
- **Instalação na tela de início** — depois do primeiro uso
- **Teste de som** — antes da primeira sessão de treino
- **Grupo** — depois da primeira sessão. Entrar num grupo vazio é anticlímax

## A tela mais importante

**A revisão do plano gerado pela IA.** Se a pessoa recebe 4 sessões × 8 exercícios e não
entende o que está vendo, aceita sem ler e nunca confia no app.

Precisa: resumo da divisão antes do detalhe · por que aqueles exercícios · trocar sem medo
de quebrar nada. É onde os 3 substitutos aparecem pela primeira vez.

Mesma regra pro upload de PDF: a tela seguinte é **lista editável**, nunca "importado com
sucesso".

---

# 9. Navegação e home

```
[ Início ]  [ Treino ]  [ Estudo ]  [ Grupo ]
```

Barra inferior. Perfil no topo da home. Aba de módulo não configurado fica oculta.

Barra importa mais em PWA que em nativo: no iPhone, em modo standalone, não existe gesto
de voltar confiável.

## Home

```
[ foto + conta ]
[ O QUE É HOJE — treino B · 19h  |  Cálculo · regra da cadeia ]
[ avisos / lembretes ]
[ números da semana ]
[ grupo — atividade dela / convidar alguém ]
```

**Ação antes de retrospectiva.** Quem abre o app está quase sempre indo agir.

As caixas não dizem "TREINO" — dizem "Treino B · próximo da fila · 6 exercícios". A
**barra navega, a home informa.**

**Sem gráficos na v1** — no dia 1 estão todos vazios. Números da semana (treinos, horas,
streak) cobrem 80% do valor com uma query simples. Gráfico entra quando houver meses de
dado, que é quando fica interessante.

Também na home:
- **Estado vazio bem resolvido** em cada bloco — dia 1 é tudo em branco
- **Dia de descanso é estado, não ausência** — "hoje é descanso · próximo: quinta, B"
- **Pendências dentro do bloco de hoje**, não numa seção separada
- **Onde você está no ciclo** — "Semana 2 · próximo: C"

**Fora:** badge interno, configurações na home, frase motivacional.

---

# 10. Coleta desde o dia 1 (pré-requisito da v2)

Barato de coletar, caro de não ter:

- **Horário real** do treino, não só a data
- **Onde a sessão foi abandonada** (qual exercício), não só "pulado"
- **Substituições circunstanciais com data** — revelam o que a pessoa evita
- **Tempo real do timer**, nunca o planejado — ensina que o bloco de 60min rende 35
- **Curtidas com timestamp**
- **Respostas do mini-questionário e da revisão semanal**

O padrão que atravessa o app inteiro: **a v1 coleta sinal, a v2 aprende com ele.**

---

# 11. Ordem de construção

| # | Item | Por quê nessa posição |
|---|---|---|
| 1 | **Teste da Opção 1** | maior incerteza, uma tarde, não bloqueia nada — roda em paralelo |
| 2 | **Migration + seed do catálogo** | destrava tudo do treino |
| 3 | **Auth + perfil + grupo** | Supabase resolve quase pronto |
| 4 | **Registro de treino offline-first** | se travar na hora de marcar série, o app morre em uma semana |
| 5 | **Motor de treino** (Prompt 1, substituição, rotação) | a parte difícil, melhor cedo |
| 6 | **Timer em primeiro plano** | timestamp + recálculo, nunca `setInterval` acumulando |
| 7 | **Estudo** (Prompts 2 e 3) | |
| 8 | **Push + pg_cron** | lembretes, não descanso |
| 9 | **Feed** | só faz sentido quando já existe atividade |
| 10 | **Revisão semanal** | |

Itens 4 e 5 decidem se o app é usado de verdade. O 8 é o que fica bonito no portfólio —
cron, fila e Edge Function são infraestrutura real, não CRUD.

---

# 12. Detalhes que dá pra decidir escrevendo o código

Nenhum bloqueia o banco nem a arquitetura:

- Estados vazios e textos do onboarding de instalação
- Conteúdo exato do resumo diário
- Quantas vezes é "múltiplas" pra disparar a pergunta de dificuldade (sugestão: 3 em 7 dias)
- Duração do bloco resumido de retomada (sugestão: metade do original)
- Se `equipamentos_indisponiveis` é por equipamento ou por exercício

---

# 13. v2 — registrado, fora de escopo

- IA aprende com histórico: dias de maior frequência, horários de melhor disposição,
  padrões de ausência
- Replanejamento **automático** a partir das revisões semanais
- Calibração da Fase A: estimativa de esforço deixa de ser chute e vira dado
- Curtidas cruzadas com execução real (curtiu mas nunca fez?)
- Gráficos de evolução, PRs
- Comentários no feed · múltiplos grupos · notificações avançadas
- Repetição espaçada de verdade (tipo Anki)
- Integração WhatsApp

---

# 14. Riscos conhecidos

- **Estudo e treino ainda são módulos colados.** O que os costura é o feed, a revisão
  semanal e a grade compartilhada. É de propósito, mas vale saber.
- **O timer de descanso no iPhone é a única funcionalidade sem solução gratuita boa.** Se
  o teste da Opção 1 reprovar, o plano B é Siri ("timer de 90 segundos") — o app cuida de
  série, carga, ciclo e registro; o alarme fica com o iOS.
- **A estimativa de esforço da Fase A é chute na primeira vez.** Não há histórico. É
  exatamente por isso que o tempo real é coletado desde a v1.
- **Quatro padrões de movimento têm poucos exercícios** (`carregamento`, `isolamento de
  antebraço`, `isolamento de costas`, `rotação`) e nenhum com `comum=1`. Nesses, o fallback
  de substitutos não tem o que oferecer.
- **Farmer Walk está classificado em bíceps** — consequência de absorver antebraço no
  grupo. Único caso onde a simplificação fica esquisita.
