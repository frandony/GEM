import { useState } from "react";
import { SessaoTreino, type ExercicioDaSessao } from "./telas/SessaoTreino";
import { novoId } from "./lib/fila";

/**
 * Casca do app.
 *
 * Ainda sem roteamento nem login — a tela de sessão foi construída
 * primeiro de propósito (item 4 da ordem do plano: se travar na hora de
 * marcar série, o app morre em uma semana). O resto vem em volta dela.
 *
 * Os dados abaixo são de exemplo, só para a tela rodar sozinha enquanto
 * auth e carregamento do plano não existem.
 */

const EXEMPLO: ExercicioDaSessao[] = [
  {
    sessaoExercicioId: "ex-1", exercicioId: 114, nome: "Supino reto com barra",
    ordem: 1, series: 4, repsMin: 6, repsMax: 8, duracaoSeg: null,
    descansoSeg: 120, unilateral: false,
  },
  {
    sessaoExercicioId: "ex-2", exercicioId: 90, nome: "Elevação lateral com halteres",
    ordem: 2, series: 3, repsMin: 10, repsMax: 15, duracaoSeg: null,
    descansoSeg: 60, unilateral: false,
  },
  {
    sessaoExercicioId: "ex-3", exercicioId: 9, nome: "Prancha isométrica",
    ordem: 3, series: 3, repsMin: null, repsMax: null, duracaoSeg: 45,
    descansoSeg: 60, unilateral: false,
  },
];

export function App() {
  const [treinoId] = useState(novoId);
  const [terminou, setTerminou] = useState(false);

  if (terminou) {
    return (
      <div className="tela">
        <div className="vazio">
          <span className="chip chip-ok">Treino concluído</span>
          <p className="text-sm">
            As séries sobem sozinhas quando houver rede.
          </p>
          <button className="btn btn-neutro" onClick={() => setTerminou(false)}>
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <SessaoTreino
      treinoSessaoId={treinoId}
      letra="A"
      exercicios={EXEMPLO}
      aoFinalizar={() => setTerminou(true)}
    />
  );
}
