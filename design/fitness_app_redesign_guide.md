# Fitness App — Especificação de Redesign

> **Para:** Claudio Code
> **De:** Design Review
> **Data:** 13/08/2026
> **Versão:** 1.0
> **Formato complementar:** `fitness_app_redesign_spec.json`

---

## 1. Resumo Executivo

O app atual funciona, mas carece de refinamento visual e hierarquia de informação. Este documento especifica um redesign baseado em princípios da Apple (clareza, hierarquia tipográfica, microinterações) e do Nubank (simplicidade, uso inteligente de cor, cards leves).

**Prioridade de implementação:**
1. Tab bar com ícones + labels
2. Reformular cards (transparência + espaçamento)
3. Hierarquia tipográfica
4. Ações hover-reveal nos exercícios
5. Barra de progresso nos treinos

---

## 2. Paleta de Cores

### Fundos
| Token | Valor | Uso |
|-------|-------|-----|
| `bg-primary` | `#0d0d0f` | Fundo da tela (não use preto puro `#000`) |
| `bg-secondary` | `rgba(255,255,255,0.04)` | Fundo dos cards |
| `bg-tertiary` | `rgba(255,255,255,0.08)` | Hover de itens, icon containers |
| `bg-hover` | `rgba(255,255,255,0.06)` | Estado hover de cards |

### Texto
| Token | Valor | Uso |
|-------|-------|-----|
| `text-primary` | `#ffffff` | Títulos, nomes, valores |
| `text-secondary` | `rgba(255,255,255,0.70)` | Labels, descrições |
| `text-tertiary` | `rgba(255,255,255,0.50)` | Metadados, timestamps |
| `text-quaternary` | `rgba(255,255,255,0.30)` | Placeholders, desabilitado |

### Destaque (verde)
| Token | Valor | Uso |
|-------|-------|-----|
| `accent-primary` | `#30d158` | Progresso, badges, botões primários |
| `accent-primary-tint` | `rgba(48,209,88,0.12)` | Fundo de badges, indicadores sutis |

### Status
| Token | Valor | Uso |
|-------|-------|-----|
| `status-success` | `#30d158` | Concluído, sucesso |
| `status-warning` | `#ff9f0a` | Atenção, timer |
| `status-danger` | `#ff453a` | Erro, excluir |
| `status-info` | `#0a84ff` | Info, links |

### Bordas
| Token | Valor | Uso |
|-------|-------|-----|
| `border-subtle` | `rgba(255,255,255,0.06)` | Separadores internos |
| `border-default` | `rgba(255,255,255,0.10)` | Bordas de cards |
| `border-focus` | `rgba(255,255,255,0.30)` | Focus rings |

---

## 3. Tipografia

**Fonte:** `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

**Pesos permitidos:** 400 (regular) e 500 (medium) apenas. Não usar 600/700.

### Escala

| Token | Tamanho | Peso | Line-height | Letter-spacing | Uso |
|-------|---------|------|-------------|----------------|-----|
| display | 28px | 500 | 1.08 | -0.5px | Contadores grandes |
| h1 | 20px | 600 | 1.2 | -0.3px | Nome do usuário, títulos |
| h2 | 17px | 600 | 1.3 | -0.2px | Título do card de treino |
| h3 | 15px | 500 | 1.4 | 0 | Nome do exercício |
| body | 16px | 400 | 1.5 | 0 | Texto corrido |
| body-emphasized | 16px | 500 | 1.5 | 0 | Texto com ênfase |
| caption | 13px | 400 | 1.4 | 0 | Metadados, saudação |
| overline | 11px | 600 | 1.2 | 0.8px | Labels de seção (ex: "TREINO") |
| micro | 10px | 500 | 1.2 | 0 | Labels da tab bar |

**Regra para números:**
```css
.numeric {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
```

---

## 4. Espaçamento e Raio

### Escala de espaçamento (px)
`4, 8, 12, 16, 20, 24, 32, 40, 48`

### Safe areas
- Horizontal: `16px`
- Entre seções: `24px`
- Entre cards: `12px`
- Padding interno do card: `16px`

### Raio de borda (px)
| Componente | Raio |
|------------|------|
| Chip / Badge | 6px |
| Botão | 8px |
| Input | 10px |
| Card | 16px |
| Panel | 12px |
| Avatar | 50% |
| Pill | 999px |

---

## 5. Componentes — Especificação Detalhada

### 5.1 Tab Bar (Bottom Navigation)

```
┌─────────────────────────────────┐
│  [🏠]    [💪]    [📚]    [👥]  │
│ Início  Treino  Estudo   Grupo  │
└─────────────────────────────────┘
```

**Especificação:**
- Altura: `64px`
- Fundo: `rgba(13,13,15,0.95)` + `backdrop-filter: blur(20px)`
- Borda superior: `1px solid rgba(255,255,255,0.06)`
- Ícone: `20px`
- Label: `10px`, weight 500
- Cor ativa: `#ffffff`
- Cor inativa: `rgba(255,255,255,0.40)`
- Distribuição: espaçamento igual entre 4 itens

**Ícones necessários:**
- Início: `home` (outline) / `home_filled` (ativo)
- Treino: `dumbbell` (outline) / `dumbbell_filled` (ativo)
- Estudo: `book` (outline) / `book_filled` (ativo)
- Grupo: `users` (outline) / `users_filled` (ativo)

### 5.2 Card de Treino

```css
.workout-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 16px;
}

.workout-card:hover {
  background: rgba(255, 255, 255, 0.06);
  transition: background 150ms ease-out;
}
```

**Estrutura interna:**
1. **Header do card:**
   - Título (h2): "Empurrar"
   - Badge (pill): "5 exercícios" — fundo `rgba(48,209,88,0.12)`, texto `#30d158`

2. **Lista de exercícios:**
   - Cada item: icon container (36×36, raio 10, bg `rgba(255,255,255,0.08)`) + text stack + action button
   - Separador: `1px solid rgba(255,255,255,0.04)` entre itens
   - Padding vertical por item: `10px`

3. **Barra de progresso:**
   - Altura: `4px`
   - Fundo: `rgba(255,255,255,0.08)`
   - Preenchimento: `#30d158`
   - Raio: `2px`
   - Margin top: `12px`
   - Animação: `width` com `transition: 300ms ease-out`

### 5.3 Exercise Row

```
┌────────────────────────────────────────┐
│ [⚙️]  Supino inclinado          [✏️] │
│       4 séries · 6–10 reps · 2 min     │
├────────────────────────────────────────┤
│ [⚙️]  Desenvolvimento            [✏️] │
│       4 séries · 6–10 reps · 2 min     │
└────────────────────────────────────────┘
```

**Comportamento:**
- **Desktop/Web:** Ícone de editar aparece apenas no hover (`opacity: 0 → 1`, `transition: 150ms`)
- **Mobile:** Swipe para a esquerda revela ações (Editar — azul, Excluir — vermelho)
- **Touch target mínimo:** `44×44px`

### 5.4 Badge

```css
.badge {
  background: rgba(48, 209, 88, 0.12);
  color: #30d158;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}
```

### 5.5 Avatar

```css
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #34c759, #30d158);
  color: #000000;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

### 5.6 Botões

**Primário:**
```css
.btn-primary {
  background: #30d158;
  color: #000000;
  padding: 12px 20px;
  border-radius: 12px;
  font-weight: 500;
  font-size: 15px;
}
```

**Secundário:**
```css
.btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  padding: 12px 20px;
  border-radius: 12px;
  font-weight: 500;
  font-size: 15px;
}
```

**Ghost:**
```css
.btn-ghost {
  background: transparent;
  color: rgba(255, 255, 255, 0.70);
  padding: 8px 12px;
  border-radius: 8px;
}
```

---

## 6. Telas — Estrutura

### 6.1 Home / Dashboard

```
┌─────────────────────────────┐
│ Olá,                    [FV]│
│ francisco                   │
│                             │
│ TREINO DE HOJE              │
│ ┌─────────────────────────┐ │
│ │ Empurrar      [5 ex]    │ │
│ │                           │ │
│ │ [⚙️] Supino inclinado   │ │
│ │      4 séries · 6–10    │ │
│ │ [⚙️] Desenvolvimento    │ │
│ │      4 séries · 6–10    │ │
│ │ [⚙️] Supino reto        │ │
│ │      3 séries · 6–10    │ │
│ │ ────────────▓▓▓▓▓▓───── │ │
│ └─────────────────────────┘ │
│                             │
│ RESUMO DA SEMANA            │
│ [3/4 treinos] [145 min]     │
│                             │
│ [Início][Treino][Est][Grp]  │
└─────────────────────────────┘
```

**Seções:**
1. **User Header:** Saudação (caption, terciário) + Nome (h1) + Avatar (direita)
2. **Workout Card:** Overline "Treino de hoje" (verde, 11px, uppercase) + título + badge + lista de exercícios + progress bar
3. **Weekly Summary:** Scroll horizontal com 3 cards de stats
4. **Quick Actions:** Grid 2×2 com ícones grandes

### 6.2 Detalhe do Treino

- Header com back button + título + subtítulo + ação "Editar"
- Card agrupado com lista de exercícios
- Floating Action Button: "Iniciar treino" (primário, bottom center)

### 6.3 Execução do Treino (Fullscreen)

- Barra de progresso fina no topo (3px, verde)
- Nome do exercício grande (h1)
- "Série X de Y" (caption)
- Timer de descanso
- Stepper para reps e peso
- Lista de séries anteriores
- Botões: "Descanso" (secundário) + "Próxima série" (primário)
- Overlay de timer circular quando em descanso

### 6.4 Perfil

- Header com avatar grande (64px) + nome + email
- Grid de stats (3 colunas)
- Lista de configurações com ícones + toggles
- Item "Sair" em vermelho

---

## 7. Interações e Microinterações

### Tap Feedback
```css
.tap-target:active {
  opacity: 0.7;
  transition: opacity 100ms;
}
```

### Swipe Actions (Mobile)
- Direção: esquerda
- Threshold: 80px
- Ações: Editar (azul), Excluir (vermelho)

### Page Transitions
- Push: slide from right
- Pop: slide to right
- Duração: 300ms
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)`

### Pull to Refresh
- Indicador circular
- Cor: `#30d158`
- Fundo: transparente

### Skeleton Loading
```css
.skeleton {
  background: rgba(255, 255, 255, 0.04);
  background-image: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.06),
    transparent
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

---

## 8. Acessibilidade

- **Touch target mínimo:** 44×44px
- **Contraste:** WCAG AA (4.5:1 para texto normal)
- **Dynamic Type:** Suportar ajuste de tamanho de fonte do sistema
- **VoiceOver:**
  - Exercise row: "{nome}, {séries} séries de {repetições} repetições, {descanso} de descanso"
  - Progress bar: "{porcentagem}% do treino concluído"
- **Reduce Motion:** Respeitar preferência do sistema

---

## 9. Recomendações Técnicas

### Frameworks
| Plataforma | Recomendação |
|------------|-------------|
| Cross-platform | React Native + Expo |
| Alternativa | Flutter (Material 3 + customização) |
| iOS nativo | SwiftUI (melhor performance e feel) |
| Android nativo | Jetpack Compose |

### Bibliotecas úteis (React Native)
- **Reanimated 3** — animações fluidas
- **React Native Gesture Handler** — gestures (swipe, pan)
- **Lottie** — animações complexas (timer, conclusão de treino)

### Performance
- Usar `FlatList` / `SectionList` para listas longas
- Memoizar componentes de exercício (`React.memo`)
- Lazy load imagens e ícones
- Manter estado do timer no nível mais baixo possível (evitar re-renders da tela inteira)

### Persistência
- `AsyncStorage` / `SecureStore` — preferências do usuário
- `SQLite` / `Realm` — histórico de treinos offline
- Sync com backend quando online

---

## 10. Checklist de Implementação

### Fase 1 — Fundação (essencial)
- [ ] Aplicar paleta de cores (fundo #0d0d0f, cards transparentes)
- [ ] Implementar escala tipográfica
- [ ] Criar componente Card com especificação
- [ ] Criar componente ExerciseRow
- [ ] Adicionar ícones na Tab Bar

### Fase 2 — Interatividade
- [ ] Hover-reveal nas ações de exercício
- [ ] Swipe actions no mobile
- [ ] Barra de progresso animada
- [ ] Tap feedback em todos os botões

### Fase 3 — Telas completas
- [ ] Tela Home/Dashboard
- [ ] Tela de detalhe do treino
- [ ] Tela de execução do treino
- [ ] Tela de perfil

### Fase 4 — Polish
- [ ] Page transitions
- [ ] Skeleton loading
- [ ] Pull to refresh
- [ ] Acessibilidade (VoiceOver/TalkBack)
- [ ] Reduce motion

---

## 11. Antes vs Depois — Resumo Visual

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Fundo dos cards | `#1c1c1e` sólido | `rgba(255,255,255,0.04)` transparente |
| Hierarquia | Tudo igual | Pesos e tamanhos diferenciados |
| Tab bar | Texto puro | Ícones + labels |
| Ações | "Editar" sublinhado | Ícone no hover/swipe |
| Progresso | Inexistente | Barra sutil no card |
| Cor de destaque | Borda decorativa | Progresso, badges, ações |
| Avatar | Não existe | Iniciais em círculo verde |
| Espaçamento | Denso | Respirado, com propósito |

---

*Documento gerado automaticamente. Para dúvidas, consultar o arquivo JSON complementar.*
