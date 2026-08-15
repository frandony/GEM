/**
 * Extração de texto de FOTO — OCR no navegador via tesseract.js.
 *
 * Existe ao lado de `pdf.ts` (que extrai texto de PDF nativo) pelo mesmo
 * motivo: a foto NUNCA sai do navegador pra este app — só o texto
 * reconhecido vai pro backend, `extrair-topicos` não recebe binário em
 * caminho nenhum.
 *
 * DEPENDÊNCIA EXTERNA — vale saber antes de confiar cegamente nisto: por
 * padrão, `createWorker()` baixa o motor (worker + core wasm) e o pacote
 * de idioma de `cdn.jsdelivr.net/npm/tesseract.js-core` em tempo de
 * execução, não deste servidor. Confirmado no bundle de produção. Ou
 * seja: "a foto não sai do navegador" continua verdade, mas o MOTOR de
 * OCR depende de um CDN de terceiro estar no ar — se cair, "Tirar foto"
 * para de funcionar (PDF e "Gerar pela IA" continuam intactos, são
 * caminhos independentes). Auto-hospedar o worker+core+dado de idioma é
 * possível (o pacote `tesseract.js-core` e os arquivos `.traineddata`
 * dariam pra servir de `public/`), mas é mais alguns MB de asset e ficou
 * de fora desta rodada — decisão consciente, não descuido.
 *
 * Import dinâmico de propósito, mesmo raciocínio de pdf.ts: a maioria de
 * quem cadastra matéria nunca tira foto — não faz sentido isso entrar no
 * bundle inicial nem no precache do service worker (ver `globIgnores` em
 * vite.config.ts).
 *
 * OCR de foto de celular é bem menos confiável que texto de PDF nativo:
 * torto, sombra, reflexo, letra pequena. Errar mais aqui é esperado — é
 * por isso que a tela de revisão dos tópicos existe, e por isso o erro de
 * "texto insuficiente" do backend sugere tentar de novo com mais luz.
 */

const MIN_CONFIANCA = 40;

export async function extrairTextoDaImagem(arquivo: File): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  // "por" carrega o pacote de idioma português — sem ele o reconhecimento
  // tenta inglês e erra acento, cedilha, tudo que este app precisa.
  const worker = await createWorker("por");
  try {
    const {
      data: { text, confidence },
    } = await worker.recognize(arquivo);
    // Confiança baixa de verdade (foto ilegível) não deveria nem chegar
    // na IA gastando token — o guard de MIN_CARACTERES do backend pega
    // a maioria dos casos, mas uma foto nítida de texto em outro idioma
    // (ou muito manuscrito) pode devolver caracteres suficientes com
    // qualidade nenhuma. Avisar aqui é mais barato que a IA alucinar.
    if (confidence < MIN_CONFIANCA && text.trim().length < 500) {
      throw new Error(
        "A leitura da foto ficou com pouca confiança — tente de novo com mais luz e o texto reto.",
      );
    }
    return text.trim();
  } finally {
    await worker.terminate();
  }
}
