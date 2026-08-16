import type { CSSProperties } from "react";

/** "Francisco Vasconcelos" → "FV". Só letras — número ou emoji no nome
    (existe gente assim) não vira parte da inicial. */
export function iniciais(nome: string): string {
  const letras = nome
    .split(/\s+/)
    .map((p) => p.match(/\p{L}/u)?.[0] ?? "")
    .filter(Boolean);
  return ((letras[0] ?? "") + (letras[letras.length - 1] ?? "")).toUpperCase() || "?";
}

/**
 * Foto de perfil, ou iniciais quando não há uma — mesma classe `.avatar`
 * (index.css) nos dois casos, que já espera tamanho variável via
 * `--avatar-tam`. `aria-hidden`: nos dois lugares que usam isto hoje
 * (Início, Conta) o nome já aparece como texto visível ao lado — a
 * imagem/iniciais são redundantes com ele, não a única fonte da
 * informação.
 */
export function Avatar({
  nome,
  fotoUrl,
  tamanhoRem,
  className,
}: {
  nome: string;
  fotoUrl: string | null;
  tamanhoRem?: number;
  className?: string;
}) {
  const estilo = tamanhoRem ? ({ "--avatar-tam": `${tamanhoRem}rem` } as CSSProperties) : undefined;
  const classes = className ? `avatar ${className}` : "avatar";

  if (fotoUrl) {
    return (
      <img
        src={fotoUrl}
        alt=""
        aria-hidden
        className={classes}
        style={{ ...estilo, objectFit: "cover" }}
      />
    );
  }
  return (
    <span className={classes} style={estilo} aria-hidden>
      {iniciais(nome)}
    </span>
  );
}
