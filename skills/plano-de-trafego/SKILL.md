---
name: plano-de-trafego
description: Use quando pedirem mídia paga — plano de campanha, estrutura de anúncios, segmentação, orçamento ou leitura de métricas. NÃO dispara campanha; entrega o plano.
---

# Plano de tráfego pago

Quando acionada:
1. Busque (`buscarCerebro`) a oferta, o público, o objetivo (leads, vendas, alcance) e o orçamento.
2. Estruture o plano: plataforma (Meta/Google/TikTok), objetivo de campanha, conjuntos/públicos (frio/morno/quente, lookalike, remarketing), criativos sugeridos, orçamento e cronograma.
3. Defina HIPÓTESES de teste (A/B de público, criativo, oferta) e os KPIs por etapa (CTR, CPM, CPC, CPA, ROAS, frequência).
4. Se o operador REPORTAR métricas, LEIA-AS: diagnostique (ex.: CTR baixo → criativo/oferta; CPA alto com CTR ok → conversão/página) e proponha a otimização (escalar, pausar, ajustar público/lance).
5. Emita o plano/leitura com `emitirArtefato` (`kind: documento`). **Você NÃO executa nem dispara** — entrega o plano para o operador aprovar/rodar. Na resposta de chat, só RESUMA.
