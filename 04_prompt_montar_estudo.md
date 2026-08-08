# Prompt 2 — Montar plano de estudo

Roda numa Edge Function do Supabase.

## A decisão estrutural: duas chamadas, não uma

O motor de estudo tem duas naturezas misturadas — **julgamento** (quanto esforço cada
tópico exige, em que ordem faz sentido) e **aritmética** (quantos blocos cabem até a
prova, o conteúdo cabe ou não).

Aritmética não deve ir pra IA. Ela erra conta, varia entre execuções, e o número que
sai é justamente o que o usuário vai usar pra decidir quantos dias consegue estudar.
Esse número precisa ser verificável.

Então:

| Fase | Quem faz | Saída |
|---|---|---|
| **A — diagnóstico** | IA estima esforço por tópico | blocos necessários por tópico |
| **cálculo do ideal** | código | "você precisaria de N dias × M min" |
| *usuário escolhe o que consegue* | | grade real |
| **B — distribuição** | IA distribui na grade escolhida | blocos datados |

O app mostra o ideal, o usuário escolhe, e a Fase B monta em cima da realidade — que é
exatamente o fluxo definido. A Fase A roda uma vez por matéria e o resultado fica salvo:
não precisa repetir a cada replanejamento.

---

# FASE A — Estimativa de esforço

## System prompt

```
Você estima o esforço de estudo de tópicos universitários.

Devolva SOMENTE JSON válido, sem markdown, sem texto antes ou depois.

Para cada tópico, estime quantos blocos de estudo ele exige, considerando:
- a densidade conceitual do tópico
- se exige prática de exercícios além de leitura
- a dificuldade declarada pelo aluno (quando houver)

Escala: 1 bloco = tópico simples, só leitura. 2 = leitura + exercícios.
3 = tópico denso, exige prática repetida. Nunca mais que 4.

Se a dificuldade declarada for "dificil", some 1 à sua estimativa (máx 4).
Se for "facil", subtraia 1 (mín 1).
```

## User prompt

```
materia: "Cálculo 2"
duracao_bloco_min: 60
topicos:
  - id: 1, nome: "Regra da cadeia", dificuldade: null
  - id: 2, nome: "Integração por partes", dificuldade: "dificil"
```

## Saída

```json
{
  "estimativas": [
    { "topico_id": 1, "blocos": 2, "exige_exercicios": true },
    { "topico_id": 2, "blocos": 4, "exige_exercicios": true }
  ]
}
```

## Cálculo do ideal (código, não IA)

```
blocos_necessarios = soma(estimativas) + reserva_revisao
reserva_revisao    = teto(blocos_necessarios × 0.2)
dias_ate_evento    = data_evento − hoje
blocos_por_semana  = blocos_necessarios ÷ (dias_ate_evento ÷ 7)
```

O app apresenta: *"Pra cobrir os 12 tópicos até 20/set você precisaria de 4 dias por
semana, 1h por dia."* O usuário escolhe o que consegue, e o gap vira o número de
cobertura: **"com 3 dias você cobre 70% do conteúdo."**

Se não couber, as saídas são explícitas — nunca espremer silenciosamente:
adicionar horários · priorizar tópicos · aceitar cobertura parcial · reduzir profundidade.

---

# FASE B — Distribuição na grade

## System prompt

```
Você distribui tópicos de estudo numa grade fixa de horários.

Regras absolutas:
- Devolva SOMENTE JSON válido, sem markdown, sem texto antes ou depois.
- Todo bloco deve cair exatamente num slot da grade fornecida. Nunca invente horário.
- Nenhum bloco de um tópico pode ser agendado depois do evento que ele serve.
- Respeite os limites de carga informados. Nunca ultrapasse.

Sequenciamento:
- Com mais de uma matéria ativa, INTERCALE. Nunca mais de 2 blocos seguidos
  da mesma matéria.
- Dentro de uma matéria, respeite pré-requisitos: tópicos base antes dos avançados.
- Tipos de bloco: "leitura" (primeiro contato), "exercicios" (prática),
  "revisao" (retomada antes do evento).
- Tópico com exige_exercicios=true precisa de pelo menos 1 bloco "exercicios".
- Reserve os últimos blocos antes de cada prova como "revisao", priorizando
  tópicos com dificuldade "dificil" ou marcados como não compreendidos.

Eventos do tipo "entrega" não são tópicos a absorver, são trabalho a produzir.
Distribua como marcos: pesquisar → escrever → revisar. O último marco deve cair
pelo menos 1 dia antes do prazo.

Se o conteúdo não couber na grade, NÃO comprima. Agende o que cabe, respeitando
prioridade, e liste o que ficou de fora em "nao_alocados".
```

## User prompt

```
semana_inicio: "2026-08-10"
horizonte_semanas: 6

grade:                                  # slots fixos, definidos pelo usuário
  - { dia_semana: "ter", hora: "19:00", duracao_min: 60 }
  - { dia_semana: "qui", hora: "19:00", duracao_min: 60 }
  - { dia_semana: "sab", hora: "09:00", duracao_min: 90 }

limites:
  max_blocos_dia: 2
  max_minutos_dia: 150
  dia_leve_semanal: "dom"

semanas_off: ["2026-08-24"]             # não recebem blocos

materias:
  - id: 1
    nome: "Cálculo 2"
    topicos:
      - { id: 1, nome: "Regra da cadeia", blocos: 2, exige_exercicios: true,
          dificuldade: null, compreendido: null }
    eventos:
      - { tipo: "prova", data: "2026-09-20", topicos: [1,2,3] }
  - id: 2
    nome: "Estrutura de Dados"
    eventos:
      - { tipo: "entrega", data: "2026-09-05", descricao: "Trabalho de árvores AVL" }

topicos_pendentes: [7, 9]               # não cobertos no ciclo anterior, reabsorver
```

## Saída

```json
{
  "blocos": [
    {
      "data": "2026-08-11",
      "hora": "19:00",
      "duracao_min": 60,
      "materia_id": 1,
      "topico_id": 1,
      "tipo": "leitura",
      "titulo": "Regra da cadeia — primeiro contato"
    },
    {
      "data": "2026-08-13",
      "hora": "19:00",
      "duracao_min": 60,
      "materia_id": 2,
      "topico_id": null,
      "tipo": "marco",
      "titulo": "Trabalho AVL — levantar referências"
    }
  ],
  "nao_alocados": [
    { "topico_id": 9, "motivo": "sem slot disponível antes da prova" }
  ]
}
```

`nao_alocados` é obrigatório mesmo vazio — é o que alimenta o contador de tópicos
pendentes na home e o aviso de "plano desatualizado".

---

## Validação (servidor, antes de gravar)

**Bloqueantes**
1. JSON parseia e bate com o schema
2. Todo bloco cai num par (dia_semana, hora) que existe na grade
3. Nenhum bloco em semana marcada como off
4. Nenhum bloco de um tópico depois do evento que ele serve
5. Todo `materia_id` e `topico_id` existe
6. Limites de carga respeitados (blocos/dia e minutos/dia)
7. Nenhum bloco no dia leve
8. Último marco de cada entrega ≥ 1 dia antes do prazo
9. `nao_alocados` presente e coerente: todo tópico ou tem bloco, ou está na lista

**Avisos (entram no retry)**
10. Nunca mais de 2 blocos seguidos da mesma matéria
11. Tópico com `exige_exercicios` tem ao menos 1 bloco de tipo `exercicios`
12. Existe pelo menos 1 bloco `revisao` antes de cada prova

---

## Falha

1. **Retry 1x** com a lista de violações anexada
2. **Fallback determinístico** — e aqui o fallback é bom, não é rede de segurança pobre:
   round-robin das matérias pelos slots, na ordem dos tópicos, com os últimos 20% dos
   blocos marcados como revisão. Sem IA, sem sequenciamento inteligente, mas gera um
   plano válido e utilizável
3. A tela sinaliza que a distribuição é automática simples e oferece refazer

---

## Replanejamento

Mesma Fase B, com três diferenças:

- `semana_inicio` é sempre a **próxima** semana — a corrente fica congelada, conforme
  a regra de replanejamento semanal
- Blocos já concluídos não entram e seus tópicos saem da lista
- `topicos_pendentes` traz o que ficou para trás; substituições e ajustes manuais que
  o usuário fez na grade são preservados como entrada, não regerados

A Fase A **não roda de novo** — as estimativas de esforço já estão salvas. Só roda para
tópicos novos.

---

## Pontos abertos

- **Estimativa de esforço é chute na primeira vez.** Não há histórico no começo. É por
  isso que o tempo real do timer é coletado desde a v1: na v2, a Fase A deixa de ser
  estimativa e passa a ser calibração.
- **Pré-requisito entre tópicos é inferido pela IA a partir do nome.** Funciona
  razoavelmente numa ementa em ordem, mas não é confiável. Se doer, vira um campo
  `ordem` no tópico, preenchido na importação do PDF.
- **`duracao_bloco_min` está fixo por grade.** Se um slot é de 90min e outro de 60, a
  estimativa da Fase A (que assume um valor) fica imprecisa. Aceitável na v1.
