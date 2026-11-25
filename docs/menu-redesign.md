# Motor Lab Racing · Box 17

O menu apresenta a sessão solo do Vale do Cedro em uma garagem de competição. A carroceria e o piloto usam o mesmo modelo carregado para a corrida. O mapa e a linha de largada vêm das amostras do circuito.

## Direção criativa

| Conceito | Avaliação |
| --- | --- |
| Motorsport Cinematic | Escolhido. O box enquadra o kart em três quartos e usa sinais amarelos, concreto e verde industrial. A preparação no box e o contra o relógio pertencem à mesma cena. |
| Racing Festival | Grafismos e batida mais intensos favoreceriam uma seleção de eventos. O Vale do Cedro tem uma sessão solo e uma ação principal. |
| Underground Motorsport | O contraste e a luz industrial funcionam como variação noturna. O menu mantém legibilidade e atmosfera distintas nas opções diurnas. |

A apresentação do veículo em Brand Central, a progressão de preparação no Builders Cup e a identidade gráfica independente de Unbound orientaram a análise de composição, fluxo e personalidade. A garagem, os grafismos e a síntese sonora foram criados para este projeto. [Gran Turismo 7](https://www.gran-turismo.com/us/gt7/manual/brandcentral/02) · [Forza Motorsport](https://forza.net/news/forza-motorsport-builders-cup) · [NFS Unbound](https://www.ea.com/ea-play/news/nfs-unbounds-signature-style-gdc-2023)

## Implementação

- A garagem e a pista usam o mesmo dispositivo WebGPU e alvos de canvas próprios. A garagem pode aparecer depois que o kart carrega enquanto a pista termina de preparar os pipelines. Ao entrar na corrida, os recursos exclusivos da garagem são liberados. A pose em repouso usa o rig existente e mantém o piloto em contato com o volante e os pedais.
- A garagem interpola os presets de dia, entardecer e noite. Na chuva, o pátio externo recebe partículas, asfalto com rugosidade reduzida e reflexos. A seleção de clima, período e recorde continua ligada ao estado real da corrida. A preferência por movimento reduzido desativa a animação contínua e a transição visual para a pista.
- Um AudioContext atende a música original a 132 BPM, o ambiente, os sons de interface e os sons de corrida. O mixer persiste níveis e mute. Música e ambiente de garagem saem na transição para a pista.
- A interface mantém o carregamento e seus erros acessíveis. Em operação, o controle principal é entrar na pista. O mapa SVG e o minimapa usam a mesma projeção. A seleção pendente mantém o painel no lugar e só é persistida após a preparação da pista.

## Assets e licenças

| Asset | Origem |
| --- | --- |
| Geometria, materiais, sinalização da garagem e céu procedural | Criados em código para Motor Lab Racing. |
| Música, efeitos de interface e ambiente do menu | Síntese original em Web Audio. |
| Kart, pintura, capacete e piloto autorais | Reutilizados de `go-kart` e `public/assets/kart/kart-body.glb`. O tecido Bi Stretch tem licença CC0. [Inventário](../go-kart/LICENSES.md) |
| Variante Racer / Go Kart de GRIP420 | Disponível na prévia em loopback. O chassi CC BY-NC-ND 4.0 fica fora do pacote público. O jogo publicado usa o conjunto autoral. [Inventário local](../README.md#kart-enviado-para-teste-local) · [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) |
| Vista do Vale do Cedro e materiais da pista | Reutilizados do projeto. A vista usa Alps Field, Poly Haven, CC0. [Inventário](../public/assets/vale-do-cedro/SOURCES.md) |

## Frentes e ferramentas

| Skill ou ferramenta | Responsabilidade | Frente | Fase |
| --- | --- | --- | --- |
| Superpowers · using-superpowers, brainstorming | Aplicar o briefing e comparar as três direções | Coordenação | Descoberta e direção |
| Superpowers · dispatching-parallel-agents, subagent-driven-development | Isolar interface, gráficos e áudio e pedir revisão independente | Coordenação Sol | Produção e revisão |
| frontend-design, product-frontend-design | Hierarquia, sinalização, mapa e controles desktop | Terra | Interface |
| Superpowers · test-driven-development | Mapa e grafo de áudio | Coordenação, Luna | Implementação |
| Serena, RTK, token-saviour, Context Mode `ctx_execute`, Ponytail | Localizar integrações, resumir inventário e validar alterações pontuais | Coordenação e especialistas | Auditoria e produção |
| browser-harness, Chrome DevTools, verification-before-completion | Executar e capturar o jogo, verificar estados e comparar desempenho | Coordenação | Validação |
| Caveman | Redação concisa das atualizações e da entrega | Coordenação | Comunicação |

Foi usado Sol para gráficos e revisão independente, Terra para interface e Luna para áudio. A configuração do modelo principal é controlada pelo ambiente. `impeccable`, `ui-ux-pro-max`, `ui-ux-design-system` e `canvas-design` não estavam instaladas no catálogo consultado.

## Validação desktop

Capturas do build de produção com o kart autoral foram inspecionadas em 1920 × 1080, 2560 × 1440, 3440 × 1440 e 3840 × 2160. Incluem dia, entardecer, noite, chuva diurna e noturna, foco, painel de áudio, pista e pausa. Chrome também confirmou teclado, mudanças de clima e período, restauração de preferências após recarga, mute, largada, aceleração, troca de câmera, pausa, retomada e nova sessão. Um controle padrão simulado acionou a aceleração. Em movimento reduzido duas capturas espaçadas permaneceram idênticas e a entrada ocorreu sem a transição. Com WebGPU indisponível, o menu exibe uma mensagem de erro e o botão para recarregar. A garagem e a pista usam exclusivamente o backend WebGPU.

### Desempenho

Comparação em Chrome no Apple M3 Max, viewport 1920 × 1080, DPR 1, aba em primeiro plano e a mesma variante de kart local. Tempos de quadro são intervalos entre 180 callbacks de `requestAnimationFrame` após cada cenário estabilizar. O tempo de carregamento é uma amostra por versão, até habilitar a largada.

| Cenário | Antes | Box 17 |
| --- | ---: | ---: |
| Abertura, p50 / p95 / p99 | 13,3 / 14,0 / 14,3 ms | 13,3 / 14,0 / 14,3 ms |
| Pista parada no grid, p50 / p95 / p99 | 13,3 / 13,7 / 14,3 ms | 13,3 / 13,9 / 14,2 ms |
| Largada disponível | 914 ms | 977 ms |
| Primeira cena WebGPU da garagem | — | 469 ms |

O build exclui o GLB de 21,1 MB da variante local. A cópia de produção em preview abriu a garagem em 378 ms e habilitou a largada em 968 ms na amostra registrada. A build passou com o aviso de chunk JavaScript acima de 500 kB. `node --test` passou com 23 testes e o console ficou sem erros ou avisos durante o fluxo principal.

### Revisão criativa

| Critério | Nota / 10 | Evidência |
| --- | ---: | --- |
| Direção de arte, identidade, tipografia | 8 / 8 / 8 | Sinalização do box, branco e amarelo nas ações, leitura imediata da marca. |
| Fidelidade visual, composição, iluminação, materiais | 7,5 / 8 / 7,5 / 7 | Kart inteiro em quatro resoluções, recorte claro, concreto com desgaste e pátio molhado. O acabamento do piloto autoral e dos armários ainda é simples. |
| Game UI/UX, acessibilidade | 8,5 / 8 | CTA visível, mapa real, teclado, foco e movimento reduzido. A avaliação de acessibilidade foi funcional. |
| Animação, motion design | 7,5 / 8 | Pose sentada, variação discreta no rig, câmera lenta e transição curta. |
| Game feel, imersão, originalidade | 8 / 8 / 8 | Condições mudam no box e seguem para a corrida. Sinalização, geometria e trilha têm identidade própria. |
| Performance, qualidade técnica | 8 / 8 | Cadência semelhante na amostra comparável e um só dispositivo de renderização. |
| Direção musical, sound design | Pendente de escuta | O áudio real foi capturado em Chrome após gesto válido. O analisador mediu pico aproximado de −22 dBFS no menu e −28 dBFS no trecho de pista. |

A revisão independente levou a menos brilho no pátio, mais luz de recorte, ferramentas reconhecíveis na bancada, chuva mais esparsa e melhor separação entre capacete e batente. Permanecem abertas a avaliação auditiva, a medição de tempo e memória de GPU em outras máquinas, a validação com gamepad físico e o refinamento de detalhes do modelo autoral. A meta estética de 9/10 ficou acima da avaliação desta versão.
