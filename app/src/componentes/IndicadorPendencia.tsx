import { useEffect, useState } from "react";
import { aoMudarFila, quantasPendentes, sincronizar } from "../lib/fila";

/**
 * "N séries aguardando sincronizar."
 *
 * Não é enfeite: no iOS não existe Background Sync (§2 do plano). A fila
 * só anda com o app aberto. Sem este indicador, a pessoa fecha o app
 * achando que salvou — e perde o treino.
 *
 * Fica escondido quando não há nada pendente. Aviso permanente vira
 * ruído, e ruído a pessoa aprende a ignorar.
 */
export function IndicadorPendencia() {
  const [n, setN] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const atualizar = () => void quantasPendentes().then(setN);
    atualizar();

    const soltar = aoMudarFila(atualizar);
    const mudouRede = () => setOnline(navigator.onLine);
    globalThis.addEventListener("online", mudouRede);
    globalThis.addEventListener("offline", mudouRede);

    return () => {
      soltar();
      globalThis.removeEventListener("online", mudouRede);
      globalThis.removeEventListener("offline", mudouRede);
    };
  }, []);

  if (n === 0) return null;

  return (
    <button
      className="pendente"
      onClick={() => void sincronizar()}
      // role de status: leitor de tela anuncia sem roubar o foco de quem
      // está no meio de digitar a carga.
      role="status"
    >
      {online
        ? `${n} ${n === 1 ? "registro" : "registros"} sincronizando`
        : `${n} ${n === 1 ? "registro salvo" : "registros salvos"} no aparelho · sem rede`}
    </button>
  );
}
