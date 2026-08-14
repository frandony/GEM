/**
 * Extração de texto de PDF no cliente — o arquivo NUNCA sai do
 * navegador. `extrair-topicos` (Edge Function) só recebe o texto já
 * extraído, nunca o binário: ver o comentário no topo daquela função.
 *
 * Import dinâmico de propósito (chamado só de dentro de
 * `extrairTextoDoPdf`, não no topo do módulo que importa este arquivo):
 * pdf.js é ~1MB com o worker, e a maioria de quem abre "Nova matéria"
 * nunca importa PDF — não faz sentido isso entrar no bundle inicial nem
 * no precache do service worker.
 */

const MAX_PAGINAS = 40;

export async function extrairTextoDoPdf(arquivo: File): Promise<string> {
  const [pdfjsLib, { default: workerUrl }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const bytes = await arquivo.arrayBuffer();
  const documento = await pdfjsLib.getDocument({ data: bytes }).promise;

  const paginas: string[] = [];
  const total = Math.min(documento.numPages, MAX_PAGINAS);
  for (let i = 1; i <= total; i++) {
    const pagina = await documento.getPage(i);
    const conteudo = await pagina.getTextContent();
    const texto = conteudo.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    paginas.push(texto);
  }
  return paginas.join("\n\n").trim();
}
