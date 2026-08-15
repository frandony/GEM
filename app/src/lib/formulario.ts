import { useCallback, useId, useRef, useState } from "react";

/* =====================================================================
   Validação de formulário — uma convenção só para o app inteiro.
   =====================================================================
   Substitui três improvisos que conviviam: botão `disabled` mudo
   (Grupo), mensagem no fim de um formulário longo (Estudo) e banner no
   topo da tela, longe do campo (GradeEstudo, EditarPlano).

   A regra, em uma frase: **o botão de submit fica habilitado, e quem
   explica o que falta é o submit.** Ver o comentário de `.btn:disabled`
   em index.css para o porquê — resumo: `pointer-events: none` faz o
   toque num botão desabilitado não gerar evento nenhum, e quem tenta
   enviar recebe silêncio absoluto.

   Três decisões que não são estilo:

   1. **Não revalida a cada tecla.** `validar` roda no submit; `limpar`
      roda no onChange e só APAGA o erro. Validação agressiva grita
      antes de a pessoa terminar de digitar o nome.

   2. **Marca todos os inválidos, foca o primeiro.** Corrigir um erro por
      vez, com um envio a cada rodada, é o padrão que faz desistir.

   3. **Erro sem campo na tela não some.** Existe caso real: em
      "Nova matéria" no modo PDF, os inputs de tópico nem são
      renderizados. Um erro que aponta para um campo inexistente não tem
      onde ancorar — vai para `errosSemCampo`, que a tela mostra num
      `.aviso-form` acima do botão. Sem isso, o erro sumiria em silêncio,
      que é exatamente o bug que este arquivo existe para matar.
   ===================================================================== */

export interface RegraDeValidacao<C extends string> {
  campo: C;
  /** `true` = passou. Escrito na afirmativa de propósito: `!!nome.trim()`
      lê melhor que a negação no ponto de uso. */
  valido: boolean;
  mensagem: string;
}

export interface PropsDeCampo {
  ref: (el: HTMLElement | null) => void;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

export interface Validacao<C extends string> {
  erros: Partial<Record<C, string>>;
  /** Mensagens cujo campo não está montado — mostrar em `.aviso-form`. */
  errosSemCampo: string[];
  /** Valida tudo, marca os inválidos e foca o primeiro. `true` = passou. */
  validar: (regras: Array<RegraDeValidacao<C>>) => boolean;
  /** Espalhar no input: `{...campo("nome")}`. */
  campo: (nome: C) => PropsDeCampo;
  /** Chamar no onChange — apaga o erro enquanto a pessoa corrige. */
  limpar: (nome: C) => void;
  idDoErro: (nome: C) => string;
  limparTudo: () => void;
}

export function useValidacao<C extends string>(): Validacao<C> {
  const [erros, setErros] = useState<Partial<Record<C, string>>>({});
  const [errosSemCampo, setErrosSemCampo] = useState<string[]>([]);
  // useId, e não um contador: a mesma tela pode ter dois formulários com
  // um campo "nome" cada (é o caso de Grupo.tsx), e ids repetidos fariam
  // o aria-describedby de um apontar para a mensagem do outro.
  const base = useId();
  const refs = useRef(new Map<C, HTMLElement>());

  const idDoErro = useCallback((nome: C) => `${base}-${nome}-erro`, [base]);

  const validar = useCallback((regras: Array<RegraDeValidacao<C>>) => {
    const novos: Partial<Record<C, string>> = {};
    const soltos: string[] = [];
    let primeiroInvalido: HTMLElement | null = null;

    for (const regra of regras) {
      if (regra.valido) continue;
      const el = refs.current.get(regra.campo);
      if (el) {
        novos[regra.campo] = regra.mensagem;
        primeiroInvalido ??= el;
      } else {
        soltos.push(regra.mensagem);
      }
    }

    setErros(novos);
    setErrosSemCampo(soltos);

    if (primeiroInvalido) {
      // `preventScroll` + scrollIntoView separados de propósito: o scroll
      // nativo do focus() usa `nearest`, que no iOS deixa o campo atrás
      // do teclado que acabou de subir. `center` resolve.
      primeiroInvalido.focus({ preventScroll: true });
      primeiroInvalido.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return Object.keys(novos).length === 0 && soltos.length === 0;
  }, []);

  const campo = useCallback(
    (nome: C): PropsDeCampo => ({
      ref: (el) => {
        if (el) refs.current.set(nome, el);
        else refs.current.delete(nome);
      },
      ...(erros[nome]
        ? { "aria-invalid": true as const, "aria-describedby": idDoErro(nome) }
        : {}),
    }),
    [erros, idDoErro],
  );

  const limpar = useCallback((nome: C) => {
    setErros((atual) => {
      if (!(nome in atual)) return atual; // evita re-render a cada tecla
      const proximo = { ...atual };
      delete proximo[nome];
      return proximo;
    });
  }, []);

  const limparTudo = useCallback(() => {
    setErros({});
    setErrosSemCampo([]);
  }, []);

  return { erros, errosSemCampo, validar, campo, limpar, idDoErro, limparTudo };
}
