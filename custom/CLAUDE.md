# custom/ — a SUA zona de customização (leia antes de mudar qualquer coisa)

Você (IA assistente do dono desta instância) está num produto **atualizável por
1-clique**. Estas regras existem pra que as customizações do dono **sobrevivam a
todo update**. Siga-as à risca.

## 1. Regra de ouro

**Só crie/edite arquivos DENTRO de `custom/`** — minúsculo exato, case-sensitive
(`Custom/` ou `CUSTOM/` NÃO são preservados). **Todo o resto do repositório é
sobrescrito na próxima atualização** do produto. Se algo fora de `custom/` for
editado, o update ainda faz um backup do estado atual num branch
`awave-backup/pre-<versão>` — mas a edição SOME da main. Não conte com isso:
trabalhe dentro de `custom/`.

## 2. Os 7 pontos de extensão

### 2.1 Tool de agente — `custom/tools/index.ts`

Registre no array `TOOLS`; depois ligue a tool por agente na tela `/agentes`.
`requerAprovacao: true` faz a execução virar uma APROVAÇÃO em `/aprovacoes`
(humano decide) em vez de rodar na hora — use em tudo que escreve/gasta/envia.

```ts
import { z } from 'zod'
import { definirToolCustom, type ToolCustom } from '@/server/custom/contrato'

const baixarEstoque = definirToolCustom({
  id: 'baixar_estoque', // snake_case, 3-40 chars, começa com letra, único
  titulo: 'Baixar estoque',
  descricao: 'Use quando o usuário pedir para dar baixa em unidades de um produto do estoque.',
  inputSchema: z.object({
    sku: z.string().describe('Código do produto'),
    quantidade: z.number().int().positive().describe('Unidades a baixar'),
  }),
  requerAprovacao: true, // escreve no banco ⇒ passa por /aprovacoes (HITL)
  execute: async (ctx, input) => {
    const { sku, quantidade } = input // já tipado a partir do inputSchema (sem cast)
    const db = ctx.db() // Supabase com service role — acesso total às SUAS tabelas
    const { data: atual, error: erroLeitura } = await db
      .from('meu_estoque').select('quantidade').eq('sku', sku).maybeSingle()
    if (erroLeitura) throw new Error(`Falha ao ler estoque: ${erroLeitura.message}`)
    if (!atual) throw new Error(`SKU "${sku}" não existe em meu_estoque`)
    const restante = Math.max(0, atual.quantidade - quantidade)
    const { error } = await db.from('meu_estoque').update({ quantidade: restante }).eq('sku', sku)
    if (error) throw new Error(`Falha ao baixar estoque: ${error.message}`)
    return { sku, baixado: quantidade, restante }
  },
})

export const TOOLS: ToolCustom[] = [baixarEstoque]
```

O `ctx` (tipo `CustomToolCtx`) traz: `agentId`, `operatorId`, `conversationId`,
`db()` (client Supabase service-role) e `getSetting(chave)` (lê a tabela `settings`,
`null` se ausente). O `input` chega validado pelo `inputSchema` e já **tipado a
partir dele** (via `definirToolCustom`) — use `input.sku` direto, sem cast. Se
mudar o `inputSchema`, o TypeScript reclama no `execute` na hora (erro cedo).

### 2.2 Tela — `custom/pages/index.tsx`

Cada página registrada abre em **`/c/<slug>`**, já com o menu lateral do produto.

```tsx
import { definirPaginaCustom, type PaginaCustom } from '@/server/custom/contrato'

function PainelEstoque() {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold">Painel de estoque</h1>
      <p className="mt-2 text-sm opacity-70">Esta tela é sua — abre em /c/painel-estoque.</p>
    </div>
  )
}

const painelEstoque = definirPaginaCustom({
  slug: 'painel-estoque', // kebab-case, 3-40 chars, único
  titulo: 'Painel de estoque',
  Componente: PainelEstoque,
})

export const PAGINAS: PaginaCustom[] = [painelEstoque]
```

CSS extra vai em `custom/estilos.css` (carregado em todas as telas).

### 2.3 Endpoint de API — `custom/api/index.ts`

Cada endpoint registrado atende **`/api/c/<slug>`**. O core aplica a autenticação
de OPERADOR **antes** de chamar o seu handler — você não precisa checar login.
Na v1 só existem **GET e POST** em `/api/c/` (outros métodos não são despachados).

```ts
import { definirApiCustom, type ApiCustom } from '@/server/custom/contrato'

const estoque = definirApiCustom({
  slug: 'estoque', // kebab-case, 3-40 chars, único
  GET: async (_req, ctx) => {
    const { data } = await ctx.db().from('meu_estoque').select('sku, quantidade')
    return Response.json({ itens: data ?? [] })
  },
  POST: async (req, ctx) => {
    const corpo = (await req.json()) as { sku?: string; quantidade?: number }
    if (!corpo.sku) return Response.json({ erro: 'sku obrigatório' }, { status: 400 })
    await ctx.db().from('meu_estoque').upsert({ sku: corpo.sku, quantidade: corpo.quantidade ?? 0 })
    return Response.json({ ok: true })
  },
})

export const APIS: ApiCustom[] = [estoque]
```

### 2.4 Migration SQL — `custom/migrations/9NNN_nome.sql`

SQL das SUAS tabelas. Roda sozinho no boot, junto com as oficiais. A faixa
**9000–9999 é obrigatória**; **expand-only** (nunca DROP/rename do que o core usa).
Detalhes e exemplo em `custom/migrations/LEIA-ME.md`.

```sql
-- custom/migrations/9001_meu_estoque.sql
create table if not exists meu_estoque (
  sku text primary key,
  quantidade integer not null default 0
);
```

Os três pontos a seguir (config, webhooks, rotinas) formam um **conjunto**: um caso
comum é receber um webhook de uma ferramenta externa (Hotmart, um CRM) usando um
segredo que o dono cola num campo de config, e uma rotina que faz o sync no sentido
inverso. O exemplo abaixo é ponta a ponta com esse trio.

### 2.5 Config no /config — `custom/config/index.ts`

Declare os campos que o dono precisa preencher (chaves de API, tokens, URLs). Cada
um vira um **card no `/config`**. Tipo `segredo` mascara o valor e grava no Vault;
`texto`/`url` gravam na tabela `settings`. Convenção: nomeie a chave com prefixo
`custom_`.

```ts
import { definirConfigCustom, type ConfigCustom } from '@/server/custom/contrato'

const hottok = definirConfigCustom({
  chave: 'custom_hotmart_hottok', // prefixo custom_ por convenção
  rotulo: 'Hottok da Hotmart',
  tipo: 'segredo', // mascara e grava no Vault (texto/url gravam em settings)
})

export const CONFIGS: ConfigCustom[] = [hottok]
```

O dono abre o `/config`, vê o card "Hottok da Hotmart", cola a chave e salva. A partir
daí o webhook e a rotina leem esse valor por `ctx.getSecret('custom_hotmart_hottok')`,
sem você tocar em código de novo.

### 2.6 Webhook de entrada — `custom/webhooks/index.ts`

Registre no array `WEBHOOKS`. Cada webhook atende **`/api/hooks/<slug>`** (URL pública
que o dono cola no painel da ferramenta externa). O core cuida de **verificar a
assinatura, responder o ACK (200) na hora, garantir idempotência e refazer a entrega
em caso de erro (retry)**. Você **não implementa nada disso**, só declara o
descriptor `auth` e escreve o `processar`.

```ts
import { definirWebhookCustom, type WebhookCustom } from '@/server/custom/contrato'

const vendas = definirWebhookCustom({
  slug: 'vendas', // a URL vira /api/hooks/vendas (cole na Hotmart)
  // O core lê o segredo do Vault pelo NOME (não o valor) e valida ANTES de chamar processar.
  auth: { tipo: 'token', em: 'query', param: 'hottok', segredo: 'custom_hotmart_hottok' },
  // Chave de dedup: mesma transação chega 1× só (o core descarta a repetida).
  dedupDe: 'body.data.purchase.transaction',
  processar: async (evento, ctx) => {
    // `evento.body` é `unknown` (o corpo vem de fora) — faça o narrowing você mesmo:
    const b = evento.body as {
      event?: string
      data?: { buyer?: { name?: string; email?: string } }
    }
    if (b.event !== 'PURCHASE_APPROVED') return // ignore os outros eventos

    const nome = b.data?.buyer?.name ?? 'cliente'
    // ctx é o V2: além de db()/getSetting, tem getSecret/setSecret e a fachada acoes.
    await ctx.acoes.notificar({
      titulo: 'Venda nova aprovada',
      corpo: `${nome} acabou de comprar.`,
      urgencia: 'imediata',
    })
    await ctx.acoes.criarTarefa({
      agente: 'sofia',
      descricao: `Dar boas-vindas ao ${nome} (${b.data?.buyer?.email ?? 'sem e-mail'}).`,
    })
  },
})

export const WEBHOOKS: WebhookCustom[] = [vendas]
```

Fluxo do core (você não escreve nada disso): recebe o POST em `/api/hooks/vendas`,
confere o `hottok` da query contra o segredo do Vault, responde 200 na hora
(ACK-then-queue), garante que a mesma transação não processa duas vezes (idempotência
via `dedupDe`) e chama o seu `processar` no heartbeat, com retry se ele lançar erro.
Assinatura inválida nunca chega no `processar` (o core rejeita com 401).

O `auth` é um conjunto **fechado** (a segurança mora no core): token na query, token
no header, ou HMAC no header (hex/base64). Você escolhe qual, o core valida.

### 2.7 Rotina periódica — `custom/rotinas/index.ts`

Registre no array `ROTINAS`. Cada rotina roda no heartbeat a cada `cadaMinutos`
(intervalo mínimo). Bom para polling/sync (puxar de um CRM, empurrar para uma
planilha). Opcional: se você não tem nada periódico, deixe o array vazio.

```ts
import { definirRotinaCustom, type RotinaCustom } from '@/server/custom/contrato'

const syncCrm = definirRotinaCustom({
  id: 'sync_crm', // snake_case, único (chave de agendamento/idempotência)
  cadaMinutos: 30, // roda no máximo a cada 30 min
  executar: async (ctx) => {
    const key = await ctx.getSecret('custom_crm_key') // lê a chave que o dono colou no /config
    if (!key) return // config ainda não preenchida, não faz nada
    // ... fetch no CRM usando `key`, depois grava o resultado em ctx.db() ...
    // const contatos = await fetch('https://crm.exemplo/api', { headers: { Authorization: `Bearer ${key}` } })
    // await ctx.db().from('meus_contatos').upsert(...)
  },
})

export const ROTINAS: RotinaCustom[] = [syncCrm]
```

**Sobre o `ctx` de webhooks e rotinas (o V2):** é maior que o das tools. Além de
`db()` e `getSetting(chave)`, ele traz `getSecret(nome)`/`setSecret(nome, valor)`
(Vault) e a fachada `ctx.acoes` (`notificar`, `criarTarefa`, `criarAprovacao`), o
caminho recomendado para o seu código tocar o resto do sistema.

## 3. Regras duras dos arquivos de registro

`custom/tools/index.ts`, `custom/pages/index.tsx`, `custom/api/index.ts`,
`custom/webhooks/index.ts`, `custom/rotinas/index.ts`, `custom/config/index.ts` e
`custom/estilos.css` são importados pelo core. Três regras invioláveis:

1. **Nunca delete nenhum deles** — deletar quebra o build. Pra "zerar" um ponto
   de extensão, **esvazie o array** (`export const TOOLS: ToolCustom[] = []`, e
   o mesmo vale para `WEBHOOKS`, `ROTINAS` e `CONFIGS`); pra "zerar" o CSS,
   **esvazie o arquivo** (o `estilos.css` é importado pelo layout — deletá-lo
   também quebra o build).
   (A rede do EasyPanel mantém o container antigo no ar se o build falhar, mas é
   atrito evitável.)
2. **Nada de código executando no TOPO dos arquivos de registro** — só defina e
   exporte (código roda dentro de `execute`, dos handlers e dos componentes).
   Efeito colateral no topo roda em TODO boot/bundle e pode derrubar tudo.
3. **NUNCA coloque `'use client'` no `custom/pages/index.tsx`** — componente
   interativo vai num arquivo separado (ex.: `custom/pages/MinhaTela.client.tsx`)
   com `'use client'` no topo, e o index importa.

## 4. Antes de commitar: `pnpm build`

Rode `pnpm build` e confirme que compila. Dois tipos de erro, dois momentos:
erros de **CÓDIGO** (type errors) quebram o `pnpm build`; erros de **REGISTRO**
(id/slug duplicado ou malformado, `inputSchema` que não é `z.object`) são dados
que o compilador não enxerga — e cada superfície reage do seu jeito, sempre com
a mensagem apontando o arquivo a corrigir: **telas** mostram o erro ao abrir
`/c/<slug>`; **endpoints** respondem 503 com a mensagem; **tools** somem do
`/agentes` e do chat em silêncio (o chat nunca cai por causa do registro — o
erro aparece no log e ao tentar salvar os toggles). Conserte antes de publicar.
Use sempre `pnpm` (nunca `npm`).

## 5. Branding NÃO é código

Nome, logo e identidade da empresa se configuram em **/config → Marca** — não
edite código pra isso.

## 6. Onde as coisas aparecem

- Telas: **`/c/<slug>`** (entram no menu lateral com o `titulo`).
- Endpoints: **`/api/c/<slug>`** — já autenticados como operador.
- Tools: ligadas por agente em **/agentes**; com `requerAprovacao`, passam por **/aprovacoes**.
- Webhooks: **`/api/hooks/<slug>`** — públicos, com a assinatura verificada pelo core (é a URL que você cola na ferramenta externa).
- Config: um **card no `/config`** (o dono cola a chave; `segredo` vai pro Vault).
- Rotinas: rodam no fundo (heartbeat), sem tela.
