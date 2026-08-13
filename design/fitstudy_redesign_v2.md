# FitStudy App — Especificação de Redesign Unificado v2.0

> **Para:** Claudio Code
> **De:** Design Review
> **Data:** 13/08/2026
> **Versão:** 2.0
> **Formato complementar:** `fitstudy_redesign_v2.json`

---

## 1. Filosofia de Design

### Conceito Central
O usuário não vive em silos. **Treino e estudo são duas faces da mesma disciplina diária.** A interface reflete isso unificando ambos na home, com navegação contextual para execução profunda de cada atividade.

### Princípios Apple Aplicados
1. **Clareza** — cada elemento tem propósito funcional
2. **Hierarquia tipográfica** — peso e opacidade criam níveis de informação
3. **Feedback imediato** — tap, toast, progresso visual
4. **Respiro visual** — espaçamento intencional em vez de bordas pesadas
5. **Responsividade nativa** — adaptação fluida entre mobile e desktop

---

## 2. Paleta de Cores

### Fundos
| Token | Valor | Uso |
|-------|-------|-----|
| `bg-primary` | `#0d0d0f` | Fundo da tela. NUNCA use preto puro `#000` — o #0d0d0f tem leve aquecimento que reduz fadiga em OLED |
| `bg-surface-muted` | `rgba(255,255,255,0.04)` | Fundo dos cards |
| `bg-surface` | `rgba(255,255,255,0.08)` | Hover de itens, icon containers |
| `bg-hover` | `rgba(255,255,255,0.06)` | Estado hover de cards |

### Texto
| Token | Valor | Uso |
|-------|-------|-----|
| `text-primary` | `#ffffff` | Títulos, nomes, valores |
| `text-secondary` | `rgba(255,255,255,0.70)` | Labels, descrições |
| `text-tertiary` | `rgba(255,255,255,0.50)` | Metadados, timestamps |
| `text-quaternary` | `rgba(255,255,255,0.30)` | Placeholders, desabilitado |

### Destaques Semânticos
| Token | Valor | Uso |
|-------|-------|-----|
| `accent-green` | `#30d158` | Treino, progresso, conclusão, badges de treino |
| `accent-green-tint` | `rgba(48,209,88,0.12)` | Fundo de badges verdes |
| `accent-blue` | `#0a84ff` | Estudo, timer, badges de estudo |
| `accent-blue-tint` | `rgba(10,132,255,0.12)` | Fundo de badges azuis |
| `accent-orange` | `#ff9f0a` | Avisos, evolução, estatísticas |
| `accent-purple` | `#af52de` | Disciplinas secundárias, variedade visual |
| `accent-red` | `#ff453a` | Erro, excluir, ações destrutivas |

### Bordas
| Token | Valor | Uso |
|-------|-------|-----|
| `border-subtle` | `rgba(255,255,255,0.06)` | Separadores internos, bordas de cards |
| `border-default` | `rgba(255,255,255,0.10)` | Inputs, botões secundários |
| `border-focus` | `rgba(255,255,255,0.30)` | Focus rings |

---

## 3. Tipografia

**Fonte:** `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

**Pesos permitidos:** 400 (regular), 500 (medium), 600 (semibold). Evitar 700.

### Escala Tipográfica

| Token | Tamanho | Peso | Line-height | Letter-spacing | Uso |
|-------|---------|------|-------------|----------------|-----|
| display | 56px | 500 | 1.0 | -1.0px | Timer grande, contadores |
| h1 | 24px | 500 | 1.2 | -0.3px | Título de execução |
| h2 | 20px | 500 | 1.2 | -0.3px | Nome do usuário, títulos de seção |
| h3 | 17px | 500 | 1.3 | -0.2px | Título do card |
| body | 16px | 400 | 1.5 | 0 | Texto corrido |
| body-emphasized | 16px | 500 | 1.5 | 0 | Texto com ênfase |
| label | 15px | 500 | 1.4 | 0 | Nome do exercício, disciplina |
| caption | 13px | 400 | 1.4 | 0 | Metadados, saudação, subtítulo |
| overline | 11px | 600 | 1.2 | 0.8px | Labels de seção (uppercase) |
| micro | 10px | 500 | 1.2 | 0 | Labels da tab bar |

**Regra para números:**
```css
.numeric {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
```

---

## 4. Loading States (Skeleton)

O app DEVE mostrar um estado de loading shimmer ao abrir. Isso reduz a percepção de espera e dá sensação de fluidez.

### Especificação do Shimmer
```css
.skeleton {
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.04) 25%,
    rgba(255,255,255,0.08) 50%,
    rgba(255,255,255,0.04) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
  border-radius: 8px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

### Elementos a Skeletonizar
- Header do usuário (barra de 36px)
- Cards de treino e estudo (retângulos de 180px)
- Rows de exercício/disciplina (retângulos de 56px)
- Stats pills
- Action tiles

### Duração
- **Exibição:** 2.5s a 3s (ou até os dados carregarem)
- **Fade out:** 400ms ease-out
- **Comportamento:** o skeleton some com fade, revelando o conteúdo por baixo

---

## 5. Componentes — Especificação Detalhada

### 5.1 Navegação Mobile (Bottom Tab Bar)

```
┌─────────────────────────────────┐
│  [🏠]    [💪]    [📚]    [👥]  │
│ Início  Treino  Estudo   Grupo  │
└─────────────────────────────────┘
```

- Altura: `64px`
- Fundo: `rgba(13,13,15,0.95)` + `backdrop-filter: blur(20px)`
- Borda superior: `1px solid rgba(255,255,255,0.06)`
- Ícone: `20px`
- Label: `10px`, weight 500
- Cor ativa: `#ffffff`
- Cor inativa: `rgba(255,255,255,0.40)`
- Touch target mínimo: `44×44px`

### 5.2 Navegação Desktop (Sidebar)

```
┌────────┬────────────────────────┐
│FitStudy│                        │
│        │   CONTEÚDO PRINCIPAL   │
│ [🏠] In│                        │
│ [💪] Tr│                        │
│ [📚] Es│                        │
│ [👥] Gr│                        │
│        │                        │
│v2.0    │                        │
└────────┴────────────────────────┘
```

- Largura: `240px`
- Borda direita: `1px solid rgba(255,255,255,0.06)`
- Logo: `20px`, weight 500
- Itens de nav: `15px`, weight 500, padding `10px 12px`, raio `10px`
- Inativo: `rgba(255,255,255,0.70)`
- Ativo/hover: fundo `rgba(255,255,255,0.04)`, texto `#ffffff`
- Footer: `12px`, `rgba(255,255,255,0.30)`

### 5.3 Card Unificado (Treino + Estudo)

```css
.card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 16px;
}

.card:active {
  background: rgba(255, 255, 255, 0.06);
  transition: background 150ms ease-out;
}
```

**Estrutura interna:**
1. **Overline:** `11px`, weight 600, uppercase, letter-spacing `0.8px`
   - Treino: cor `#30d158`
   - Estudo: cor `#0a84ff`
2. **Header do card:** título (h3) + badge (pill)
3. **Lista de itens:** rows com icon container + text stack + action
4. **Barra de progresso:** 4px de altura, verde, com label

### 5.4 Exercise Row

```
┌────────────────────────────────────────┐
│ [⚙️]  Supino inclinado          [✏️] │
│       4 séries · 6–10 reps · 2 min     │
├────────────────────────────────────────┤
│ [⚙️]  Desenvolvimento            [✏️] │
│       4 séries · 6–10 reps · 2 min     │
└────────────────────────────────────────┘
```

- Icon container: `36×36px`, raio `10px`, fundo `rgba(255,255,255,0.08)`
- Título: `15px`, weight 500
- Meta: `12px`, cor terciária, `tabular-nums`
- Separador: `1px solid rgba(255,255,255,0.06)`
- **Ação de editar:** aparece apenas no hover (`opacity: 0 → 1`, `150ms`)
- **Mobile:** swipe para esquerda revela "Editar" (azul) e "Excluir" (vermelho)

### 5.5 Study Subject Row

```
┌────────────────────────────────────────┐
│ █ Matemática · Cálculo I         [✓] │
│   45 min planejados                    │
├────────────────────────────────────────┤
│ █ Física · Mecânica              [ ] │
│   30 min planejados                    │
└────────────────────────────────────────┘
```

- Indicador de cor: `8×36px`, raio `4px` (azul, roxo, laranja)
- Título: `15px`, weight 500
- Tempo: `12px`, cor terciária
- Checkbox: `24×24px`, círculo
  - Unchecked: borda `2px solid rgba(255,255,255,0.10)`, fundo transparente
  - Checked: fundo `#30d158`, borda `#30d158`, ícone check em `#000`
  - Transição: `all 150ms ease-out`

### 5.6 Badge

```css
.badge {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}

.badge-green { background: rgba(48,209,88,0.12); color: #30d158; }
.badge-blue  { background: rgba(10,132,255,0.12); color: #0a84ff; }
.badge-orange{ background: rgba(255,159,10,0.12); color: #ff9f0a; }
```

### 5.7 Progress Bar

```css
.progress-track {
  height: 4px;
  background: rgba(255,255,255,0.08);
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #30d158;
  border-radius: 2px;
  transition: width 600ms ease-out;
}
```

- Label acima: `11px`, cor terciária, layout flex com espaço entre
- Usada tanto em cards de treino quanto de estudo

### 5.8 Stat Pill

```css
.stat-pill {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  padding: 12px 16px;
  min-width: 120px;
}
```

- Valor: `20px`, weight 500, `tabular-nums`
- Label: `12px`, cor terciária
- Layout: scroll horizontal com `gap: 12px`
- Scrollbar: escondida

### 5.9 Action Tile

```css
.action-tile {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 16px;
  padding: 16px;
}
```

- Ícone: `40×40px`, raio `12px`, fundo com tint da cor
- Label: `14px`, weight 500
- Sub: `12px`, cor terciária
- **Mobile:** grid 2 colunas
- **Desktop:** grid 4 colunas

### 5.10 Timer de Estudo (Pomodoro)

```css
.study-timer {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 20px;
  padding: 24px;
  text-align: center;
}
```

- Display: `56px`, weight 500, `tabular-nums`
- Label: `13px`, cor terciária
- Controles: 3 botões circulares `56×56px`
  - Play/Pause: fundo `#30d158`, ícone `#000`
  - Reset/Skip: fundo `rgba(255,255,255,0.08)`, borda sutil

### 5.11 Stepper (Execução de Treino)

```css
.stepper-btn {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.10);
  font-size: 20px;
  font-weight: 500;
}
.stepper-value {
  font-size: 28px;
  font-weight: 500;
  min-width: 80px;
  text-align: center;
}
```

- Touch target: `44×44px` (conforme Apple HIG)
- Step de peso: `2.5kg`
- Step de reps: `1`

### 5.12 Toast Notification

```css
.toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%) translateY(-100px);
  background: #30d158;
  color: #000;
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  transition: transform 400ms ease-out;
}
.toast.show {
  transform: translateX(-50%) translateY(0);
}
```

- Auto-dismiss: `2500ms`
- Usado para: série concluída, timer finalizado, ações confirmadas

---

## 6. Telas — Estrutura Completa

### 6.1 Home / Dashboard Unificado

```
┌─────────────────────────────────────┐
│ Olá,                          [FV]  │
│ francisco                           │
│                                     │
│ TREINO DE HOJE                      │
│ ┌─────────────────────────────────┐ │
│ │ Empurrar            [5 ex]      │ │
│ │                                 │ │
│ │ [⚙️] Supino inclinado      [✏️] │ │
│ │      4 séries · 6–10 · 2 min    │ │
│ │ [⚙️] Desenvolvimento       [✏️] │ │
│ │      4 séries · 6–10 · 2 min    │ │
│ │ [⚙️] Supino reto           [✏️] │ │
│ │      3 séries · 6–10 · 1.5 min  │ │
│ │ ────────────▓░░░░░░──────────── │ │
│ │ Progresso do treino          0% │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ESTUDO DE HOJE                      │
│ ┌─────────────────────────────────┐ │
│ │ Blocos de estudo    [3 disc]    │ │
│ │                                 │ │
│ │ [📘] Matemática               │ │
│ │      45 min · 2 tópicos         │ │
│ │ [📕] Física                   │ │
│ │      30 min · 1 tópico          │ │
│ │ ────────▓▓▓░░░░─────────────── │ │
│ │ Progresso de estudo         33% │ │
│ └─────────────────────────────────┘ │
│                                     │
│ RESUMO DA SEMANA                    │
│ [3/4 tr] [145 min] [12.4t] [8h est]│
│                                     │
│ AÇÕES RÁPIDAS                       │
│ [▶ Treino] [⏱ Estudo] [📊 Evo] [⚙️]│
│                                     │
│ [🏠] [💪] [📚] [👥]                 │
└─────────────────────────────────────┘
```

**Seções:**
1. **User Header:** Saudação (caption) + Nome (h2) + Avatar (direita)
2. **Workout Card:** Overline verde + título + badge verde + lista de exercícios + progress bar
3. **Study Card:** Overline azul + título + badge azul + lista de disciplinas + progress bar
4. **Weekly Stats:** Scroll horizontal com 4 pills (treinos, minutos, volume, estudo)
5. **Quick Actions:** Grid 2×2 mobile / 1×4 desktop

### 6.2 Execução do Treino

```
┌─────────────────────────────────────┐
│ ▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← progresso fino
│ ← Treino A                          │
│ Supino inclinado                    │
│ Série 2 de 4 · 60 kg · 8 reps       │
│                                     │
│           2/4                       │
│         série atual                 │
│                                     │
│ Repetições                          │
│   [−]     8     [+]                 │
│                                     │
│ Peso                                │
│   [−]    60 kg  [+]                 │
│                                     │
│ ┌─────────────┐ ┌─────────────────┐ │
│ │  ⏱ Descanso │ │  ✓ Concluir     │ │
│ │             │ │    série        │ │
│ └─────────────┘ └─────────────────┘ │
└─────────────────────────────────────┘
```

- Barra de progresso: `3px` no topo absoluto
- Back button com ícone + texto
- Título do exercício: `24px`
- Contador de série: `48px` current + `20px` total
- Stepper para reps e peso
- Ações sticky no fundo com gradiente

### 6.3 Sessão de Estudo

```
┌─────────────────────────────────────┐
│ Sessão de estudo                    │
│ Blocos de hoje                      │
│                                     │
│        ┌─────────────────┐          │
│        │                 │          │
│        │     25:00       │          │
│        │  Foco total     │          │
│        │                 │          │
│        │  [↺] [▶] [⏭]   │          │
│        │                 │          │
│        └─────────────────┘          │
│                                     │
│ DISCIPLINAS                         │
│ █ Matemática · Cálculo I       [✓] │
│   45 min planejados                 │
│ █ Física · Mecânica            [ ] │
│   30 min planejados                 │
│ █ Programação · Algoritmos     [ ] │
│   60 min planejados                 │
└─────────────────────────────────────┘
```

- Timer pomodoro com display grande
- Controles: reset, play/pause, skip
- Lista de disciplinas com checkbox circular
- Cores diferentes por disciplina (azul, roxo, laranja)

### 6.4 Lista de Treinos

- Header com greeting + título
- Cards dos 3 treinos (A, B, C)
- Cada card: título + badge + subtítulo + meta
- Tap navega para execução

### 6.5 Grupo (Coming Soon)

- Placeholder centralizado
- Emoji + título + subtítulo
- Card com padding generoso

---

## 7. Interações e Microinterações

### Tap Feedback
```css
.tap-target:active {
  opacity: 0.7;
  transition: opacity 100ms;
}
```

### Hover Reveal (Ações Secundárias)
```css
.row-action {
  opacity: 0;
  transition: opacity 150ms ease-out;
}
.row-item:hover .row-action,
.row-item:active .row-action {
  opacity: 1;
}
```

### Swipe Actions (Mobile)
- Direção: esquerda
- Threshold: 80px
- Ações: Editar (azul), Excluir (vermelho)

### Page Transitions
- Push: slide from right
- Pop: slide to right
- Duração: `350ms`
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)`

### Toast Notification
- Entrada: `translateY(-100px) → translateY(0)`
- Duração: `400ms`
- Auto-dismiss: `2500ms`
- Posição: top center

### Timer Pomodoro
- Play: inicia contagem regressiva de 25 min
- Pause: pausa sem resetar
- Reset: volta para 25:00
- Skip: reseta e mostra toast
- Ao chegar em 0: toast "Pomodoro concluído!"

---

## 8. Responsividade

### Breakpoints
| Breakpoint | Largura | Navegação | Grid Ações |
|------------|---------|-----------|------------|
| Mobile | < 640px | Bottom tab bar | 2 colunas |
| Tablet/Desktop | ≥ 640px | Sidebar fixa | 4 colunas |

### Layout Desktop
```
┌────────┬────────────────────────────────┐
│FitStudy│  Olá,                    [FV]   │
│        │  francisco                     │
│ [🏠] In│                                │
│ [💪] Tr│  TREINO DE HOJE                │
│ [📚] Es│  ┌──────────────────────────┐  │
│ [👥] Gr│  │ Empurrar      [5 ex]     │  │
│        │  │ ...                      │  │
│v2.0    │  └──────────────────────────┘  │
│        │                                │
│        │  ESTUDO DE HOJE                │
│        │  ┌──────────────────────────┐  │
│        │  │ Blocos        [3 disc]   │  │
│        │  │ ...                      │  │
│        │  └──────────────────────────┘  │
└────────┴────────────────────────────────┘
```

- Sidebar: `240px` fixa à esquerda
- Conteúdo: scroll vertical
- Tab bar: escondida
- App container: `flex-direction: row`, `height: 100vh`

---

## 9. Acessibilidade

- **Touch target mínimo:** 44×44px em TODOS os botões interativos
- **Contraste:** WCAG AA (4.5:1 para texto normal)
- **Dynamic Type:** Suportar ajuste de tamanho de fonte do sistema
- **VoiceOver:**
  - Exercise row: "{nome}, {séries} séries de {repetições} repetições, {descanso}"
  - Progress bar: "{porcentagem}% concluído"
  - Subject row: "{disciplina}, {tempo} planejados, {status}"
- **Reduce Motion:** Respeitar preferência do sistema

---

## 10. Recomendações Técnicas

### Frameworks
| Plataforma | Recomendação |
|------------|-------------|
| Cross-platform | React Native + Expo |
| Alternativa | Flutter |
| iOS nativo | SwiftUI |
| Android nativo | Jetpack Compose |

### Bibliotecas Úteis (React Native)
- **Reanimated 3** — animações fluidas (shimmer, page transitions, toast)
- **React Native Gesture Handler** — swipe actions, pan
- **Lottie** — animações de conclusão (check animado, timer)

### Performance
- `FlatList` / `SectionList` para listas longas
- `React.memo` em ExerciseRow e SubjectRow
- Lazy load de ícones
- Estado do timer isolado (evitar re-render da tela)

### Persistência
- `AsyncStorage` / `SecureStore` — preferências
- `SQLite` / `Realm` — histórico offline
- Sync com backend quando online

---

## 11. Checklist de Implementação

### Fase 1 — Fundação
- [ ] Paleta de cores aplicada globalmente
- [ ] Escala tipográfica implementada
- [ ] Skeleton loading com shimmer
- [ ] Componente Card
- [ ] Componente ExerciseRow
- [ ] Componente SubjectRow
- [ ] Navegação mobile (tab bar)
- [ ] Navegação desktop (sidebar)

### Fase 2 — Telas Principais
- [ ] Home unificada (treino + estudo + stats + ações)
- [ ] Execução de treino (stepper, progresso, ações sticky)
- [ ] Sessão de estudo (timer pomodoro, disciplinas)
- [ ] Lista de treinos
- [ ] Grupo (placeholder)

### Fase 3 — Interatividade
- [ ] Hover-reveal nas ações
- [ ] Swipe actions no mobile
- [ ] Toast notifications
- [ ] Timer pomodoro funcional
- [ ] Page transitions
- [ ] Tap feedback

### Fase 4 — Polish
- [ ] Responsividade completa (mobile + desktop)
- [ ] Acessibilidade (VoiceOver, Dynamic Type, Reduce Motion)
- [ ] Performance otimizada
- [ ] Testes em múltiplos tamanhos de tela

---

*Documento gerado automaticamente. Para dúvidas, consultar o arquivo JSON complementar.*
