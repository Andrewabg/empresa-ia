# Regras para agentes de código (Claude Code, Cursor, Codex, …)

> **PÚBLICO-ALVO — leia antes de obedecer.** Este arquivo é para o **COMPRADOR**
> que roda a instalação self-host (produto 1-clique) e quer customizar. As regras
> abaixo (só `custom/`) protegem a customização DELE de sumir no próximo update.
>
> **Se você é o time da Awave desenvolvendo o CORE do Motor** (o repo-fonte
> `awave-agents` / `empresa_ia`, com `docs/superpowers/`, `CHANGELOG.md`, migrations
> em `supabase/migrations/`), **estas regras NÃO se aplicam a você** — editar `src/`
> é exatamente o seu trabalho. Siga o `CLAUDE.md` da raiz, não este arquivo. Não
> perca tempo se perguntando se pode mexer no core: pode. Este `AGENTS.md` não é
> para você.

Este produto é **atualizável por 1-clique**: a cada update, os arquivos do core
são sobrescritos pela versão nova. Por isso (se você é o COMPRADOR customizando):

1. **Você (IA) só pode criar/editar arquivos dentro de `custom/`** — minúsculo
   exato, na raiz do repositório. **Leia `custom/CLAUDE.md` antes de qualquer
   mudança** — ele explica os 7 pontos de extensão (tools, telas, APIs, migrations,
   webhooks, rotinas, config) com exemplos completos.
2. **Arquivos fora de `custom/` são sobrescritos nas atualizações.** Editar o core
   dispara aviso de divergência e a edição some da main no próximo update (fica só
   um backup em branch `awave-backup/pre-<versão>`).
3. Nunca delete `custom/tools/index.ts`, `custom/pages/index.tsx`,
   `custom/api/index.ts`, `custom/webhooks/index.ts`, `custom/rotinas/index.ts`,
   `custom/config/index.ts` ou `custom/estilos.css` — esvazie os arrays (ou o
   arquivo, no caso do CSS). Deletar quebra o build.
4. Rode `pnpm build` (nunca `npm`) antes de commitar.
5. Nome/logo/branding não é código: configura-se em **/config → Marca**.
