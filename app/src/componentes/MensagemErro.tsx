import { TriangleAlert } from "lucide-react";

/**
 * Mensagem de erro colada ao campo que falhou.
 *
 * `role="alert"` é `aria-live="assertive"`: interrompe o leitor de tela.
 * Isso é certo aqui ("você tentou e não deu") e ERRADO para dica
 * permanente de formato (`.dica-campo`, sem role) e para confirmação de
 * sucesso (`role="status"`, que é polite).
 *
 * Limitação conhecida do `role="alert"`: ele não re-anuncia um texto
 * idêntico numa segunda tentativa. Por isso o hook `useValidacao` também
 * leva o FOCO até o campo, que carrega `aria-invalid` e
 * `aria-describedby` — ao receber foco, o leitor lê "inválido, <mensagem>".
 * As duas coisas juntas, não uma ou outra.
 */
export function MensagemErro({ id, children }: { id?: string; children: string }) {
  return (
    <p id={id} className="msg-erro" role="alert">
      <TriangleAlert size={16} aria-hidden />
      {children}
    </p>
  );
}

/**
 * Falha de servidor com o formulário aberto — vai imediatamente acima do
 * botão de submit, nunca no topo da tela (onde ficava fora da viewport).
 * Também é onde caem os erros de validação cujo campo não está montado
 * (ver `errosSemCampo` em lib/formulario.ts).
 */
export function AvisoDeFormulario({ children }: { children: React.ReactNode }) {
  return (
    <div className="aviso-form" role="alert">
      <TriangleAlert size={16} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
