# Cajon Palco Live — Publicar no GitHub Pages

Este pacote tem 5 arquivos:
- index.html (o app, com as tags de PWA ja adicionadas)
- manifest.json
- service-worker.js
- icon-192.png, icon-512.png, apple-touch-icon.png

## Passo a passo

1. Entre em https://github.com e faça login na sua conta.
2. Clique no "+" no canto superior direito → "New repository".
3. Nome do repositório: `cajon-palco-live` (pode ser outro nome, sem espaço).
4. Deixe como **Public**. Não marque nenhuma opção de "Add README" (vamos subir os arquivos direto).
5. Clique em "Create repository".
6. Na página do repositório vazio, clique no link "uploading an existing file".
7. Arraste os 5 arquivos deste pacote (index.html, manifest.json, service-worker.js, icon-192.png, icon-512.png, apple-touch-icon.png) para a área de upload.
8. Role para baixo e clique em "Commit changes".
9. Vá em **Settings** (aba do repositório) → **Pages** (menu lateral esquerdo).
10. Em "Build and deployment" → "Branch", selecione `main` e a pasta `/ (root)`. Clique em "Save".
11. Espere 1-2 minutos. Atualize a página — vai aparecer um link tipo:
    `https://SEU-USUARIO.github.io/cajon-palco-live/`
12. Abra esse link no Safari do iPhone/iPad.
13. Toque em Compartilhar → "Adicionar à Tela de Início".
14. Pronto — o ícone do Cajón Palco Live aparece na tela, abre em tela cheia, funciona offline depois da primeira abertura (o Service Worker guarda tudo em cache).

## Importante

- Esse link é público — qualquer pessoa com o endereço consegue abrir. Se quiser manter privado, dá pra configurar depois (repositório privado + GitHub Pages exige plano pago para isso, ou usamos outra alternativa).
- Nenhum login é necessário para abrir o app, nunca.
- Pra atualizar o app no futuro (nova versão do HTML), é só subir o novo index.html no mesmo repositório substituindo o antigo.
