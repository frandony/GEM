# Teste da Opção 1 — Push como timer de descanso

**Status: hipótese a validar. Primeira coisa a construir.**

Custo: uma tarde. Free tier de Vercel + Supabase. Código de descarte — não vai virar
parte do app.

---

## A aposta

O descanso entre séries é notificado por Web Push disparado do servidor, em vez de
agendamento local. Se funcionar, o PWA cobre 100% do app e o caminho nativo sai de cena
definitivamente — sem Mac, sem US$ 99, uma base de código só.

## Por que pode dar certo

Entrega da Apple costuma ficar entre 1 e 3 segundos. E **erro sistemático se compensa**:
latência consistente de 3s → agenda pra 87s em vez de 90s e acerta.

O que mata não é o atraso. É a variância.

## Por que pode não dar

Dois erros se somam:

- **Cron** — `pg_cron` tem granularidade mínima de 1 minuto. Erro aleatório de 0 a 60s,
  dependendo de onde você cai na janela. Ir abaixo disso exige um worker rodando 24h
  (não é serverless, tem custo fixo) — e nem resolveria, porque o segundo erro continua.
- **Entrega** — fila da Apple, dependente de rede e do estado de energia do aparelho.
  Cauda longa e imprevisível.

Agravante: o iOS economiza energia de forma mais agressiva com o aparelho parado há um
tempo — exatamente a situação do bolso no meio do treino.

---

## O que construir

Uma página só. Nada do app real.

1. **PWA mínimo** instalado na tela de início (service worker + manifest), com inscrição
   de push. No iPhone, push **só funciona depois de "Adicionar à Tela de Início"** — e a
   permissão exige gesto do usuário, não pode ser pedida no load.
2. **Botão "disparar em 60s"** → grava o timestamp alvo no Supabase.
3. **Endpoint manual** dispara o push. **Isso contorna o cron de propósito** — isola a
   latência de rede pura, separando o erro de entrega do erro de agendamento.
4. **Service worker** registra `Date.now()` ao receber e salva o delta.

Depois de medir a rede pura, rodar uma segunda bateria **com o `pg_cron` real**, pra ter
o número da ponta a ponta.

---

## Cenários

~30 execuções em cada:

- Wi-Fi de casa
- 4G na academia
- Modo de baixo consumo ligado
- **Aparelho parado há 20 minutos** ← o pior caso, e o mais representativo
- **Aparelho no silencioso** ← no iPhone não há vibração; se o som não sai, o aviso não
  existe, mesmo com o push chegando na hora

**Nos dois celulares.** iPhone e Android têm comportamentos diferentes o bastante pra que
o resultado possa ser aprovado em um e reprovado no outro.

---

## Métrica

**Não a média.** Pior caso, variância e taxa de falha.

Média de 2s com um evento em 20 chegando aos 45s já reprova — o que fica na memória é a
vez que não funcionou.

| Resultado | Conclusão |
|---|---|
| Consistente, variância baixa | **Aprovado.** Compensa o offset e usa push pra tudo |
| Média boa, cauda longa | **Reprovado pro descanso.** Push segue valendo pros lembretes |
| Falhas ou atrasos grandes | **Reprovado.** Cai pro plano de contingência |

---

## Se reprovar

O push **continua no projeto** — só muda de função: fim de bloco de estudo, lembrete do
treino do dia, revisão semanal. Todos toleram erro de dezenas de segundos.

Pro descanso entre séries, a contingência é:

- **Siri** — "Ei Siri, timer de 90 segundos". Celular no bolso, zero toques, alarme com
  tela bloqueada, confiabilidade total. E o botão físico de mudo do iPhone **não silencia
  alarmes do app Relógio**, diferente de som de mídia da web
- **Wake lock em primeiro plano** — pros momentos em que o celular está na mão

O app mostra "descanso sugerido: 90s" ao lado da série e não gerencia o alarme.

**Isso não é um furo no projeto.** O valor está no motor de treino, na IA do estudo, no
offline-first e na revisão semanal. Contar 90 segundos é a parte mais trivial de tudo — e
o iPhone já faz bem.

---

## Por que primeiro

É a maior incerteza do projeto e a que mais afeta arquitetura. Fechar cedo é barato;
descobrir no mês 2 é caro.

E não bloqueia nada — pode rodar em paralelo com a migration e o seed do catálogo.

---

## Testar junto, no mesmo dia

- **Wake Lock API** no iOS atual — é a peça de que a contingência depende
- **Android**: se o agendamento local (`showTrigger`) estiver disponível no Chrome, o
  timer dela funciona sem servidor nenhum. Se não, cai no mesmo esquema de push — só que
  com entrega mais confiável e **com vibração**, o que muda tudo
- **Link de Atalhos** (`shortcuts://run-shortcut?name=...`) chamado de dentro de um PWA
  em modo standalone — é esquema público e documentado, mas o comportamento a partir de
  PWA não é certo. Baixo risco, e se funcionar vira um botão opcional
