import { RotateCcw } from "lucide-react";

/**
 * "Não deu para carregar" — o estado que faltava.
 *
 * O app tinha só dois estados de leitura: carregando e vazio. Falha caía
 * no vazio, e o vazio AFIRMA coisas ("você não tem matérias", "nenhum
 * treino registrado"). Uma queda de rede virava uma mentira sobre os
 * dados da pessoa — e, na tela de Estudo, escondia a funcionalidade
 * inteira de um jeito indistinguível de "isso não foi implementado".
 *
 * Visualmente é primo do `.vazio`, mas com `badge-atencao` e um botão de
 * repetir: o vazio é um fim de linha legítimo, isto é um contratempo com
 * saída. Por isso nunca usa `--perigo` — não é erro do usuário, e não há
 * nada para ele corrigir além de tentar de novo.
 */
export function FalhaAoCarregar({
  mensagem,
  onTentarDeNovo,
}: {
  mensagem: string;
  onTentarDeNovo: () => void;
}) {
  return (
    <div className="vazio" role="alert">
      <span className="badge badge-atencao">Não deu para carregar</span>
      <p className="text-sm">{mensagem}</p>
      <button className="btn btn-neutro" onClick={onTentarDeNovo}>
        <RotateCcw size={16} /> Tentar de novo
      </button>
    </div>
  );
}
