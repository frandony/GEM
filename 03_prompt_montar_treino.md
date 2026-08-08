# Prompt 1 — Montar treino

Roda numa Edge Function do Supabase. Nunca no cliente.

## Modos

| Modo | Quando | Saída |
|---|---|---|
| `completo` | onboarding, ou "refazer todo o plano" | todas as sessões |
| `parcial` | "refazer o treino B" | só as sessões pedidas |

**Nos dois modos o contexto é o mesmo.** No parcial, as sessões que não vão ser refeitas entram como `sessoes_existentes` — a IA precisa vê-las pra não repetir exercício e pra manter a ênfase do ciclo.

---

## System prompt

```
Você monta planos de treino de musculação.

Regras absolutas:
- Escolha exercícios APENAS do catálogo fornecido. Nunca invente nome ou id.
- Devolva SOMENTE JSON válido, sem markdown, sem comentários, sem texto antes ou depois.
- Priorize exercícios com comum=1. Use comum=2 quando precisar de variedade.
  Use comum=3 apenas se não houver alternativa adequada.
- Exercícios com medida="tempo" usam duracao_seg. Nunca reps_min/reps_max.
  Exercícios com medida="reps" usam reps_min/reps_max. Nunca duracao_seg.
- Substitutos devem ter o MESMO grupo_primario e o MESMO padrao_movimento do titular.
  Prefira substitutos com equipamento diferente do titular.
- Nenhum exercício pode aparecer duas vezes na mesma sessão.
- Nenhum exercício deve se repetir entre sessões do mesmo ciclo, salvo necessidade real.

Estrutura de sessão:
- Comece pelos padrões compostos (empurrar/puxar/dominante de joelho/dominante de quadril),
  termine pelos de isolamento.
- 4 a 7 exercícios por sessão. 10 a 22 séries no total.
- Compostos: 3-5 séries, 5-10 reps, 90-180s de descanso.
- Isolamento: 2-4 séries, 10-15 reps, 45-90s de descanso.
- Abdômen e panturrilha entram como complemento, no fim.

Ênfase:
- "superior": ~2/3 do volume total em peito, costas, ombro, bíceps, tríceps.
- "inferior": ~2/3 em quadríceps, posterior, glúteo, panturrilha, adutores, abdutores.
- "equilibrado": distribuição próxima de 50/50.
- Volume = soma de séries por grupo_primario no ciclo inteiro.
```

## User prompt

```
frequencia_semanal: {2..6}
divisao: {AB | ABC | ABCD | ABCDE}
enfase: {superior | inferior | equilibrado}
modo: {completo | parcial}
sessoes_a_gerar: ["B"]                  # só no modo parcial
sessoes_existentes: [ ... ]             # só no modo parcial, JSON das outras sessões
exercicios_curtidos: [12, 47]           # ids curtidos no feed — priorize se couberem
equipamentos_indisponiveis: []          # preenchido pelo usuário ao longo do uso

CATÁLOGO:
id | nome | grupo_primario | padrao_movimento | equipamento | medida | comum
1  | Abdominal bicicleta | abdômen | rotação | peso corporal | reps | 2
...
```

O catálogo vai como tabela pipe-delimited — mais compacto que JSON e a IA lê bem.
163 linhas cabem sem problema.

---

## Schema de saída

```json
{
  "sessoes": [
    {
      "letra": "A",
      "nome": "Superior — empurrar",
      "exercicios": [
        {
          "exercicio_id": 12,
          "nome": "Supino reto com barra",
          "ordem": 1,
          "series": 4,
          "reps_min": 6,
          "reps_max": 8,
          "duracao_seg": null,
          "descanso_seg": 120,
          "substitutos": [45, 47, 51]
        }
      ]
    }
  ]
}
```

`nome` é redundante com `exercicio_id` de propósito: se os dois não baterem contra o
catálogo, a IA alucinou e a validação pega.

---

## Validação (no servidor, antes de gravar)

Ordem de execução — para na primeira falha e acumula os erros pro retry.

**Bloqueantes**
1. JSON parseia e bate com o schema
2. Todo `exercicio_id` existe no catálogo
3. `nome` bate com o `nome` do catálogo para aquele `id`
4. Nenhum id repetido dentro da mesma sessão
5. Número e letras das sessões batem com a divisão pedida
6. `medida="tempo"` → `duracao_seg` preenchido e `reps_*` nulos. E vice-versa
7. Todo substituto tem mesmo `grupo_primario` e mesmo `padrao_movimento` do titular
8. Nenhum exercício usa equipamento em `equipamentos_indisponiveis`

**Avisos (não bloqueiam, mas entram no retry)**
9. Séries por sessão entre 10 e 22
10. 4 a 7 exercícios por sessão
11. Proporção de ênfase dentro de ±15% do alvo
12. Menos de 20% dos exercícios com `comum=3`

A checagem 11 é a que fecha o ciclo do produto: **a ênfase se autovalida.** Soma séries
por região e confere contra o que foi pedido. Se pediu superior e saiu 50/50, a geração
falhou — sem ninguém precisar revisar.

---

## Falha

1. **Retry 1x** com os erros de validação anexados ao prompt:
   `"A resposta anterior violou: [lista]. Corrija e devolva o JSON novamente."`
2. **Fallback:** 4 templates fixos, um por divisão (AB, ABC, ABCD, ABCDE), sem ênfase.
   Genéricos de propósito — é rede de segurança, não produto.
3. A tela mostra que o plano é um modelo padrão e sugere ajustar ou tentar de novo.

---

## Pontos abertos

- **`carregamento` tem 1 exercício e `isolamento de antebraço` tem 3, todos comum≥2.**
  O fallback de substitutos não funciona nesses padrões, e a regra de priorizar comum=1
  não tem o que priorizar. Ou some mais exercícios, ou aceite que esses padrões
  praticamente não vão ser escolhidos.
- **`isolamento de costas` e `rotação`** têm o mesmo problema em menor grau.
- Definir se `equipamentos_indisponiveis` é por equipamento (polia, máquina) ou por
  exercício individual. Por exercício é mais preciso, mas exige o usuário marcar item
  a item.
