/* =====================================================================
   Fila local de escrita — offline-first
   =====================================================================
   A regra do §2 do plano: "Registro de série NUNCA falha por rede."

   Como isso funciona:
     1. a tela grava na fila (IndexedDB) e segue em frente na hora
     2. a UI já mostra o resultado — escrita otimista
     3. a fila tenta subir; se falhar, tenta de novo depois

   Duas coisas fazem isso ser seguro:

   - **id gerado no cliente.** Cada item tem um uuid criado aqui. O upsert
     no Postgres usa esse id como chave, então reenviar o mesmo item duas
     vezes não duplica nada. Sem isso, uma fila que retenta viraria série
     em dobro.

   - **IndexedDB, não localStorage.** localStorage é síncrono (trava a
     thread da UI no meio do treino) e o Safari limpa com mais facilidade.

   O que NÃO fica só aqui: nada. O Supabase é a fonte da verdade; esta
   fila é buffer. Se o aparelho for perdido antes de sincronizar, o que
   está aqui se perde — e é por isso que o indicador de pendência precisa
   estar visível na tela (§2), não escondido.
   ===================================================================== */

import { supabase } from "./supabase";

const BANCO = "treino-fila";
const LOJA = "pendentes";
const VERSAO = 1;

export interface ItemFila {
  id: string;
  tabela: "series_registros" | "treino_sessoes" | "blocos" | "bloco_respostas";
  /** upsert cobre inserir e corrigir; o id do cliente resolve o conflito. */
  operacao: "upsert";
  dados: Record<string, unknown>;
  criadoEm: number;
  tentativas: number;
  ultimoErro?: string;
}

let bancoAberto: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (bancoAberto) return bancoAberto;

  bancoAberto = new Promise((ok, falha) => {
    const req = indexedDB.open(BANCO, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOJA)) {
        const loja = db.createObjectStore(LOJA, { keyPath: "id" });
        loja.createIndex("criadoEm", "criadoEm");
      }
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });

  return bancoAberto;
}

async function comLoja<T>(
  modo: IDBTransactionMode,
  fn: (loja: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const tx = db.transaction(LOJA, modo);
    const req = fn(tx.objectStore(LOJA));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}

/* ---------------------------------------------------------------------
   API da fila
   --------------------------------------------------------------------- */

/** Enfileira e dispara o envio. Não espera a rede: devolve na hora. */
export async function enfileirar(
  tabela: ItemFila["tabela"],
  dados: Record<string, unknown> & { id: string },
): Promise<void> {
  const item: ItemFila = {
    id: dados.id,
    tabela,
    operacao: "upsert",
    dados,
    criadoEm: Date.now(),
    tentativas: 0,
  };

  await comLoja("readwrite", (l) => l.put(item));
  avisarMudanca();

  // Dispara sem aguardar: quem chamou já pode desenhar a tela.
  void sincronizar();
}

export async function pendentes(): Promise<ItemFila[]> {
  const itens = await comLoja<ItemFila[]>("readonly", (l) => l.getAll());
  return itens.sort((a, b) => a.criadoEm - b.criadoEm);
}

export async function quantasPendentes(): Promise<number> {
  return comLoja<number>("readonly", (l) => l.count());
}

let sincronizando = false;

/**
 * Sobe a fila em ordem. Uma execução por vez — duas em paralelo
 * mandariam o mesmo item duas vezes e disputariam a mesma linha.
 */
export async function sincronizar(): Promise<{ enviados: number; restantes: number }> {
  if (sincronizando || !navigator.onLine) {
    return { enviados: 0, restantes: await quantasPendentes() };
  }

  sincronizando = true;
  let enviados = 0;

  try {
    for (const item of await pendentes()) {
      const { error } = await supabase
        .from(item.tabela)
        .upsert(item.dados, { onConflict: "id" });

      if (!error) {
        await comLoja("readwrite", (l) => l.delete(item.id));
        enviados++;
        continue;
      }

      // 4xx do PostgREST = dado inválido ou RLS negando. Retentar não
      // conserta e a fila entope, travando tudo que veio depois. Sai da
      // fila e vai para a quarentena, onde o app pode mostrar o problema.
      const permanente = /^(22|23|42|PGRST)/.test(error.code ?? "");
      if (permanente) {
        console.error(`fila: erro permanente em ${item.tabela}`, error);
        await quarentenar(item, error.message);
        await comLoja("readwrite", (l) => l.delete(item.id));
        continue;
      }

      // Falha de rede: mantém na fila e para o laço. Insistir nos
      // próximos só gastaria bateria — a rede caiu para todos.
      await comLoja("readwrite", (l) =>
        l.put({ ...item, tentativas: item.tentativas + 1, ultimoErro: error.message }),
      );
      break;
    }
  } finally {
    sincronizando = false;
    avisarMudanca();
  }

  return { enviados, restantes: await quantasPendentes() };
}

/* ---------------------------------------------------------------------
   Quarentena — o que falhou por motivo que não se resolve sozinho
   --------------------------------------------------------------------- */
const QUARENTENA = "treino-quarentena";

async function quarentenar(item: ItemFila, erro: string): Promise<void> {
  try {
    const atual = JSON.parse(localStorage.getItem(QUARENTENA) ?? "[]");
    atual.push({ ...item, ultimoErro: erro, quarentenadoEm: Date.now() });
    localStorage.setItem(QUARENTENA, JSON.stringify(atual.slice(-50)));
  } catch {
    // Storage cheio ou bloqueado: perder a quarentena é aceitável,
    // travar o app não é.
  }
}

export function itensEmQuarentena(): Array<ItemFila & { quarentenadoEm: number }> {
  try {
    return JSON.parse(localStorage.getItem(QUARENTENA) ?? "[]");
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------
   Notificação de mudança — a UI escuta para atualizar o indicador
   --------------------------------------------------------------------- */
type Ouvinte = () => void;
const ouvintes = new Set<Ouvinte>();

export function aoMudarFila(fn: Ouvinte): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function avisarMudanca() {
  for (const fn of ouvintes) fn();
}

/* ---------------------------------------------------------------------
   Gatilhos de sincronização
   ---------------------------------------------------------------------
   No iOS não existe Background Sync — a fila só anda com o app aberto.
   Por isso são vários gatilhos, e por isso o indicador de pendência
   precisa ficar visível: a pessoa não pode fechar o app achando que
   salvou. É a limitação do §2 virando requisito de tela.
   --------------------------------------------------------------------- */
export function iniciarSincronizacao(): () => void {
  const tentar = () => void sincronizar();

  globalThis.addEventListener("online", tentar);
  // `visibilitychange` cobre voltar de outro app; `focus` cobre voltar
  // de outra aba. No iOS o primeiro é o que realmente dispara.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tentar();
  });
  globalThis.addEventListener("focus", tentar);

  const relogio = setInterval(tentar, 30_000);
  tentar();

  return () => {
    globalThis.removeEventListener("online", tentar);
    globalThis.removeEventListener("focus", tentar);
    clearInterval(relogio);
  };
}

/** uuid do cliente. É o que torna o reenvio idempotente. */
export function novoId(): string {
  return crypto.randomUUID();
}
