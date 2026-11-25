# Motor Lab Racing

Jogo 3D de kart para navegador. A V1 tem um circuito autoral, **Vale do Cedro**, e sessões solo de contra o relógio.

```sh
npm ci
npm run dev
```

Abra o endereço exibido pelo Vite. Para produzir os arquivos estáticos de publicação, use `npm run build`. O resultado fica em `dist/`. Use `npm run preview` para servi-lo localmente.

## Requisito do navegador

O jogo requer WebGPU e um navegador/dispositivo com um adaptador WebGPU disponível. A renderização não usa WebGL como alternativa. Se WebGPU não estiver disponível, a tela informa o requisito e não inicia a corrida. Use uma versão atual do Chrome em um dispositivo com suporte a WebGPU para jogar.

## Pilotagem

- WASD ou setas: acelerar, frear/dar ré e dirigir.
- C: alternar entre perseguição próxima, câmera traseira ampla e visão do piloto.
- R: voltar à posição inicial e reiniciar a tentativa.
- Esc: pausar ou retomar.
- Controle com layout padrão: analógico esquerdo para dirigir, gatilhos para acelerar e frear.
- Telas de toque têm quatro botões de pilotagem.

O cronômetro começa quando o kart cruza a linha no sentido da pista. Para contar um tempo, passe pelos checkpoints em ordem e mantenha-se dentro dos limites. O recorde pessoal fica no navegador e usa o ID da pista como chave.

## Outros traçados

O catálogo fica em `src/track.js`. Um traçado define ID, nome, largura, semente, checkpoints e pontos X/Z em metros. O primeiro ponto marca a largada. A geometria do asfalto, os limites, o minimapa e o cronômetro usam esse traçado. O primeiro traçado é o padrão. Para abrir outra entrada, use `?pista=<id>`. As seções com zebras e a posição dos boxes podem ser definidas por pista.


## Protótipo visual do Vale do Cedro

O grid e a torre dos boxes fazem parte do primeiro trecho de avaliação. O asfalto e o céu carregam como arquivos locais durante a inicialização. As fontes e licenças estão em `public/assets/vale-do-cedro/SOURCES.md`.

O modelo autoral de produção — kart, piloto e materiais — vem de `go-kart/source/go-kart-assembled.blend`. O GLB carregado pelo jogo fica em `public/assets/kart/kart-body.glb` e usa o nível hero, com cerca de 90 mil triângulos. Para reconstruzir e publicar esse asset:

```sh
blender -b --python go-kart/scripts/package.py -- --output-root /tmp/go-kart-package
cp /tmp/go-kart-package/production/go-kart-hero.glb public/assets/kart/kart-body.glb
npm run build
```

A simulação usa a mesma geometria de colisão e posição das rodas. Se o GLB não carregar, o jogo usa a versão anterior do modelo para que a sessão continue disponível.

## Kart enviado para teste local

O [Go Kart de GRIP420](https://sketchfab.com/3d-models/go-kart-db54b705c0e546229fb43c55d7e7ad3f) tem licença [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). Para preparar a cópia local com o piloto posicionado e as articulações de direção:

```sh
blender --background --python-exit-code 1 --python tools/build-kart.py -- /caminho/para/go_kart.glb
```

Para usar o [Racing Helmet SC04 de SDC PERFORMANCE](https://sketchfab.com/3d-models/racing-helmet-sc04tm-d6f200597f0f4c748a2f30f07a2793d8), também sob [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/), passe o arquivo do capacete como segundo argumento:

```sh
blender --background --python-exit-code 1 --python tools/build-kart.py -- /caminho/para/go_kart.glb /caminho/para/racing_helmet_-_sc04tm.glb
```

O terceiro argumento opcional é o [Rally Driver Character de 3dUVpro](https://sketchfab.com/3d-models/rally-driver-character-a0fb3a4b28b8450e993a7a5913dbf70f), licenciado sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). A adaptação coloca a malha do piloto na posição sentada, aplica os materiais amarelo e grafite, acrescenta a personalização nas costas e usa o capacete SC04.

```sh
blender --background --python-exit-code 1 --python tools/build-kart.py -- /caminho/para/go_kart.glb /caminho/para/racing_helmet_-_sc04tm.glb /caminho/para/rally_driver_character.glb
```

Use `?kart=importado` em `localhost` ou `127.0.0.1` para abrir `.local-assets/go-kart-fitted.glb`, tanto no servidor de desenvolvimento quanto no preview. A pasta é ignorada pelo Git e a build estática inclui o GLB Racer usado no jogo e o modelo autoral de fallback.

## Prévia do piloto Racer

O jogo local carrega o **Racer** do Mixamo no `go_kart.glb` quando a prévia está disponível. A combinação também pode ser selecionada explicitamente com `?piloto=mixamo`. A prévia usa a malha, o esqueleto e as texturas do FBX oficial. Ela acrescenta a pose sentada, as cores do Motor Lab e o vínculo das mãos com o volante. [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)

Para reconstruir a prévia, passe o GLB do kart e o FBX baixado pelo Mixamo ao Blender:

```sh
blender --background --factory-startup --python-exit-code 1 --python tools/fit_mixamo.py -- /caminho/para/go_kart.glb /caminho/para/Ch20_nonPBR.fbx --output .local-assets/mixamo-kart.glb --blend .local-assets/mixamo-kart.blend
```
