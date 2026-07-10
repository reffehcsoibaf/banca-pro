# Changelog — Banca Pro

Todas as mudanças relevantes do app ficam registradas aqui, da mais recente para a mais antiga.
O número de versão aparece no rodapé do próprio app, então é sempre possível conferir qual versão
está publicada e comparar com o que está descrito aqui.

## v1.0.0 — 10/07/2026

Primeira versão com número de versão rastreado. Este marco reúne o que já estava em produção até
esta data, com base no que foi acompanhado nas conversas mais recentes:

### Navegação
- App reorganizado em abas no topo — Cadastro, Filtros, Lista, Saldos e Configurações — funcionando
  igual em desktop e celular (antes só o celular tinha navegação por abas, com uma barra fixa embaixo
  da tela; o desktop mostrava tudo empilhado). A barra inferior do celular foi removida.
- Navegação por teclado nas abas (setas ←→, Home/End) e anúncio da aba selecionada para leitor de tela.

### Leitor de Bilhete (IA)
- Leitura automática de bilhetes de aposta via foto/print ou texto colado, pré-preenchendo o
  formulário de cadastro (casa, data/hora, stake, status, eventos com esporte/liga/mercado/seleção/odd).
- Estratégia de provedor: tenta Google Gemini primeiro (gratuito), com fallback automático para
  Anthropic Claude se o Gemini falhar.
- Mapeamento de mercados e sugestão de opções que ainda não existem nas listas do Banca Pro, exibidas
  como chips clicáveis para adicionar rapidamente.

### Infraestrutura
- Hospedado em Cloudflare Workers (arquivos estáticos + rota `/api/ler-bilhete`).
- Chaves de API (Gemini, Anthropic) nunca ficam no navegador — vivem só como variáveis de ambiente
  no Cloudflare.

> Nota: como o rastreamento de versão começa agora, este primeiro registro é um resumo do estado
> atual, não um histórico completo de tudo que já foi feito desde o início do projeto. A partir daqui,
> toda mudança relevante entra como uma entrada nova.

---

## Como usar este changelog daqui pra frente

A cada mudança relevante entregue, um novo bloco de versão é adicionado no topo deste arquivo,
seguindo o padrão:

```
## vX.Y.Z — DD/MM/AAAA
- O que mudou, em linguagem direta.
```

- **X (major)**: mudança estrutural grande ou que quebra algo do funcionamento anterior.
- **Y (minor)**: novo recurso.
- **Z (patch)**: correção de bug ou ajuste pequeno.

O rodapé do app (`index.html`) é atualizado junto, na mesma entrega, para sempre bater com este arquivo.
