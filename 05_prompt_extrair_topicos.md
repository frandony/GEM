# Prompt 3 — Extrair tópicos do plano de ensino

O mais simples dos três, mas o que mais depende do que acontece **antes** da chamada.

## Antes do prompt: extração do texto

O PDF não vai pra IA como arquivo. O texto é extraído primeiro — `pdf.js` no cliente ou
uma lib na Edge Function — e só o texto vai no prompt.

Três casos a tratar antes de chamar a IA:

| Caso | Detecção | Ação |
|---|---|---|
| PDF digital normal | texto extraído > 200 caracteres | segue |
| PDF escaneado (imagem) | texto vazio ou quase | não chama a IA; oferece digitação manual |
| Documento muito longo | > ~15k caracteres | corta pelas seções de ementa/conteúdo |

O PDF escaneado é o caso real e frequente — professor que fotocopiou o plano. Chamar a
IA com texto vazio gasta tokens e devolve alucinação.

---

## System prompt

```
Você extrai a lista de tópicos de conteúdo de um plano de ensino universitário.

Devolva SOMENTE JSON válido, sem markdown, sem texto antes ou depois.

O que extrair:
- Os tópicos de CONTEÚDO da disciplina (ementa, conteúdo programático, unidades).
- O nome da disciplina, se estiver identificável.

O que NÃO extrair:
- Objetivos, competências, metodologia, critérios de avaliação, bibliografia.
- Nomes de professores, códigos de disciplina, carga horária.
- Numeração das unidades ("1.2 Derivadas" vira "Derivadas").

Granularidade: entre 8 e 15 tópicos.
- Se o documento listar 40 subitens, agrupe nos temas maiores.
- Se listar 3 unidades muito amplas, quebre em subtemas identificáveis no texto.
- Cada tópico deve caber em uma frase curta e ser estudável isoladamente.

Ordem: preserve a ordem do documento. Ela costuma refletir pré-requisitos.

Datas: se o documento trouxer um cronograma com datas de prova ou entrega, liste
em "datas_encontradas". NUNCA as inclua como fato — são sugestões a confirmar.

Se o texto não for um plano de ensino, devolva topicos vazio e
tipo_documento com o que você identificou.
```

## User prompt

```
TEXTO EXTRAÍDO DO PDF:
"""
{texto}
"""
```

---

## Saída

```json
{
  "materia_detectada": "Cálculo Diferencial e Integral II",
  "tipo_documento": "plano_de_ensino",
  "topicos": [
    { "ordem": 1, "nome": "Técnicas de integração" },
    { "ordem": 2, "nome": "Integrais impróprias" }
  ],
  "datas_encontradas": [
    { "descricao": "Avaliação 1", "data_texto": "15/09", "tipo": "prova" }
  ],
  "confianca": "alta"
}
```

`ordem` é o campo que resolve o ponto aberto do Prompt 2: o sequenciamento de
pré-requisitos deixa de ser inferido pelo nome e passa a vir do documento.

`confianca` é auto-declarada — `baixa` faz a tela de revisão abrir com aviso mais
forte, não bloqueia nada.

---

## Validação

**Bloqueantes**
1. JSON parseia e bate com o schema
2. `topicos` entre 0 e 25 itens
3. Nenhum tópico duplicado (comparação normalizada, sem acento e sem numeração)
4. Nenhum tópico com menos de 3 ou mais de 120 caracteres
5. `ordem` sequencial a partir de 1, sem buracos

**Avisos**
6. Entre 8 e 15 tópicos — fora disso, a tela sugere agrupar ou dividir
7. `tipo_documento != "plano_de_ensino"` → aviso claro na tela

---

## A tela seguinte é obrigatória

Extração de PDF erra. A tela depois do upload é **lista editável**, nunca
"importado com sucesso":

- Todos os tópicos em campos editáveis, com opção de remover e adicionar
- Reordenação manual
- `datas_encontradas` aparecem **desmarcadas**, como sugestão. O usuário marca as que
  valem. Cronograma de faculdade atrasa — a data que vale é a que ele confirma
- Se `confianca` for baixa ou o tipo do documento não bater, o aviso vem antes da lista

Nada é gravado antes da confirmação.

---

## Variante: gerar pelo nome da matéria

Mesmo schema de saída, sem PDF. É o atalho para quem não tem o arquivo.

```
Liste os tópicos de conteúdo tipicamente cobertos na disciplina "{nome}"
em um curso de graduação em {curso}, no Brasil.
Entre 8 e 15 tópicos, na ordem usual de ensino.
```

**Regras de uso:**
- `confianca` sempre `"baixa"` — a resposta não vem de nenhum documento real
- A tela deixa explícito que é um rascunho e que a ementa da turma pode divergir
- `datas_encontradas` sempre vazio

Isso é ponto de partida editável, nunca verdade. Ementa varia entre faculdades e a IA
não sabe o que a turma pulou.

---

## Falha

1. **Retry 1x** se o JSON não parsear
2. **Sem fallback automático.** Diferente dos prompts 1 e 2 — não existe "plano de ensino
   genérico" que faça sentido. Se falhar, o caminho é a digitação manual, que já é uma
   das três entradas previstas
3. A tela de digitação manual precisa estar sempre acessível, não só como recuperação
   de erro

---

## Ponto aberto

**Ementa em imagem é o caso mais provável de falha real.** OCR resolveria, mas é
infraestrutura a mais (serviço externo ou lib pesada na Edge Function) para um caso que
acontece algumas vezes por semestre.

Na v1, digitação manual é a resposta. Se doer na prática, o upgrade natural é mandar o
PDF como imagem direto pra IA, que lê imagem nativamente — sem OCR separado.
