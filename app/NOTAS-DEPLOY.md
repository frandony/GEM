# Deploy — o que o `vercel.json` resolve

Sem `rewrites`, a Vercel serve arquivo estático e mais nada: qualquer
caminho que não seja um arquivo real vira **404 de verdade**, com
`content-type: text/plain`. Medido em 2026-08-13, antes da correção:

```
/treino          404
/auth/callback   404
/rota-inexistente 404
```

Isso passou despercebido por meses porque o **service worker do PWA
escondia o problema**: uma vez instalado, ele responde à navegação com o
`index.html` do cache, sem chegar na rede. Quem já tinha o app aberto
nunca viu 404. Quem chegava pela primeira vez — ou clicava no link de
confirmação do e-mail, que abre no navegador do app de e-mail, sem
service worker nenhum — batia direto na 404.

Era a segunda causa da confirmação de conta não funcionar depois da
mudança para `megs.digital`. A primeira estava no `emailRedirectTo`
(ver `src/lib/supabase.ts`).

## A regra

```
"source": "/((?!.*\\.[a-zA-Z0-9]+$).*)"
```

Manda para o `index.html` só o caminho **sem extensão de arquivo**.
Caminho com extensão (`/icones/999.png`) continua dando 404 de verdade,
que é o certo: reescrever asset inexistente para o `index.html` faz o
app carregar dentro de uma tag `<img>` e foi o que deixou a tela presa
em "Carregando…" no relatório de teste.

## Configuração da Vercel

O **Root Directory** do projeto precisa ser `app` — é onde vivem o
`package.json`, o `vite.config.ts` e este arquivo. Se estiver na raiz do
repositório, este `vercel.json` não é lido.
