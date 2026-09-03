Verificado directamente lo esencial. Aquí está el informe.

---

# Auditoría de código — TradingView App

## 1. Resumen ejecutivo

El código está, en general, bien construido: cero `any` en las rutas financieras críticas, cero TODO/FIXME pendientes, middleware que falla cerrado, sin SSRF en los cuatro proxies públicos, sin secretos hardcodeados ni fuga de `service_role`, y la mayoría de los invariantes que documenta CLAUDE.md (gating de lectura, `snapToOHLC`, `SUB_PANE_KEYS`, `useBatchedTicks`, manejo UTC, Volume Profile, `pnlAtExit`, ROI real) se sostienen verificados en el código actual.

El problema no está en la arquitectura sino en el **manejo de errores del camino de ejecución de órdenes** y en un **hueco de gating en el camino de escritura**. Hay tres defectos que pueden costar dinero real: TP/SL que fallan en silencio dejando posiciones apalancadas sin protección, `modifyOrder` que puede cancelar una orden y no reponerla en cuentas hedge, y órdenes que se enrutan al exchange conectado sin verificar que el símbolo graficado pertenezca a ese venue. A eso se suma que las credenciales de exchange viajan como query string en un poll cada 2 segundos.

---

## 2. Seguridad (crítico)

### 2.1 Secretos hardcodeados — sin hallazgos

No hay credenciales de exchange ni `service_role` en el código. Solo `.env.example` está commiteado y `.gitignore` excluye correctamente `.env*`. Las únicas variables expuestas al cliente son el par esperado `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`src/lib/supabase/client.ts:5-6`, `src/lib/supabase/server.ts:7-8`, `src/middleware.ts:8-9`). **Correcto.**

### 2.2 Claves de exchange: almacenamiento y transporte

**Crítico — `apiKey` y `apiSecret` en localStorage sin cifrar.** `src/lib/store/trading-store.ts:739-742`: el `partialize` incluye explícitamente ambos campos, así que zustand los escribe como JSON plano bajo la clave `"trading-store"`. Cualquier XSS, extensión de navegador o acceso al perfil local lee credenciales de trading en vivo con un `localStorage.getItem("trading-store")`. La UI lo declara ("Keys are stored locally in your browser", `src/components/trading/ApiKeyDialog.tsx:186-187`), así que parece una decisión consciente, pero sigue siendo el riesgo de secretos de mayor impacto de la app: si la clave tiene permiso de retiro, el radio de explosión es la cuenta completa.

**Alto — credenciales enviadas en query string GET.** Todas las lecturas de cuenta mandan `apiKey`/`apiSecret` en la URL, no en el body:

- `src/lib/store/trading-store.ts:256-264` (`fetchBalance`), `:278-287` (`fetchOrders`), `:300-308` / `:329-336` (posiciones), `:364-373` (`syncAccount`), `:415-418` (position-mode)
- `src/components/trading/ApiKeyDialog.tsx:26-34` (test de conexión)
- Lado servidor: `src/lib/exchanges/account.ts:253-265` (`readAccountParams` lee de `url.searchParams`), consumido en `src/app/api/trade/{balance,orders,positions,sync}/route.ts` y `position-mode/route.ts:9-10`

`syncAccount` corre cada 2 segundos, así que la clave y el secreto quedan escritos en texto plano en logs de acceso de Vercel, cualquier proxy intermedio y el historial del navegador, de forma continua durante toda la sesión. Las rutas que **mutan** (order, leverage, trading-stop, close) sí usan body POST (`trading-store.ts:459-463, 521-525, 574-578, 602-613, 639-646, 682-692, 719-723`) — el problema es exclusivo del lado de lectura, que es justamente el de mayor frecuencia.

**Sin hallazgos:** ninguna ruta devuelve las credenciales en la respuesta ni las loguea.

### 2.3 Rutas de API

**Auth: correcta hoy, pero de capa única.** Ninguna de las 12 rutas bajo `src/app/api/**/route.ts` verifica la sesión por su cuenta (grep de `getClaims|getUser` bajo `src/app/api` da cero). Todo depende de `src/middleware.ts:35-41`, que sí falla cerrado:

```ts
let authenticated = false;
try { const { data, error } = await supabase.auth.getClaims();
      authenticated = !error && !!data?.claims?.sub; }
catch { authenticated = false; }
```

El matcher (`src/middleware.ts:72-76`) excluye exactamente `api/yahoo`, `api/fred`, `api/coingecko` y `api/trade/exchange-info` — las cuatro son datos públicos sin credenciales y cacheables, la exclusión es correcta y está completa. Las 8 rutas `/api/trade/*` restantes siguen protegidas. **No hay deriva entre el matcher y el árbol de rutas actual.** El riesgo residual (Bajo) es que si el matcher se rompiera alguna vez, las 8 rutas se convertirían en un proxy de exchange abierto para cualquiera con credenciales filtradas; conviene un chequeo de sesión redundante dentro de cada handler.

**SSRF: sin hallazgos.** Los cuatro proxies insertan el parámetro con `encodeURIComponent` sobre un host hardcodeado — `src/app/api/yahoo/route.ts:60-72` (además `interval`/`range` salen de una tabla fija, `:32-48`), `src/app/api/fred/route.ts:38-45`, `src/app/api/coingecko/route.ts:56-57,108-113` (con `days` acotado a 1–365), `src/app/api/trade/exchange-info/route.ts:50-55`. No hay forma de redirigir el fetch a otro host.

**Medio — cero rate limiting en toda la app.** No existe throttling en `/api/trade/order` (colocación de órdenes), ni en `/auth/callback`, ni en los proxies públicos más allá del `Cache-Control` de CDN — que no protege cuando el atacante varía el parámetro y evade la clave de caché (el propio comentario en `src/app/api/coingecko/route.ts:9` menciona el límite de ~30 req/min del upstream).

**Medio — open redirect en `/auth/callback`.** `src/app/auth/callback/route.ts:7,13`: `next` se toma del query string sin validar y se concatena como string (`${origin}${next}`) en lugar de `new URL(next, origin)`. Un payload tipo `next=@evil.com/phish` produce `https://app.com@evil.com/phish`, que muchos navegadores interpretan como userinfo + host `evil.com`. Dispara justo después de `exchangeCodeForSession`, así que es un vector de phishing directo contra un usuario recién autenticado — encadenable con 2.2 para pedirle que "reconecte" sus claves de API.

### 2.4 Validación de input

- **Medio** — `src/app/api/trade/leverage/route.ts:35` solo comprueba veracidad (`!leverage`). Un `-5` o `1e9` pasa y se reenvía tal cual al exchange (`:41-45,57-69`). Sin cota local `1 <= leverage <= 125`.
- **Bajo** — `src/app/api/trade/order/route.ts:22-23,54-73`: `quantity`, `price` y `stopPrice` se toman del body sin verificar que sean números positivos y finitos; igual en `src/lib/exchanges/bybit.ts:415-457` (`body.qty = a.quantity`, línea 426). Toda la seguridad cuantitativa queda delegada al exchange.
- **Bajo** — `symbol` no se valida contra un patrón `^[A-Z0-9]+$` en ninguna ruta de trading. No es SSRF (nunca cae en host/path), pero conviene endurecerlo.
- **Sin hallazgos** — todas las rutas envuelven su lógica en `try/catch` con respuesta JSON, así que no hay crash de la función serverless por input malformado.

---

## 3. Correctitud de trading (crítico)

### Invariantes verificados como correctos

Vale registrarlos porque son los que más suelen romperse: `pnlAtExit` firma por el lado de la **posición**, no de la orden reduceOnly (`src/lib/trading/sizing.ts:126-134`, con `OrderLinesLayer.tsx:1010-1074` pasando siempre `side: posSide`, y el camino genérico protegido por `line.entryPrice`, indefinido en órdenes sueltas — `OrderLinesLayer.tsx:954`). `Position.percentage` es ROI real en ambos mappers (`src/lib/exchanges/bybit.ts:163-173`, `src/lib/exchanges/account.ts:214-228`). El precio de liquidación nunca se recalcula en cliente (`bybit.ts:183`, `account.ts:239`). La dirección de trigger de Bybit es correcta en las 4 combinaciones lado/tipo (`bybit.ts:447-454`). `useTradingSync` sigue siendo el único poll de cuenta — verificado por grep, los demás `setInterval` son ticker público, countdown o debounce. Y el matching TP/SL↔posición en hedge (`OrderLinesLayer.tsx:607-625`) **no** es ambiguo pese a matchear solo por símbolo+lado: cerrar un long siempre es SELL y cerrar un short siempre es BUY, así que las dos posiciones nunca colisionan.

### Bugs

**🔴 Crítico — fallos de TP/SL tragados en silencio.** `src/lib/store/trading-store.ts:473-505` (patas reduceOnly de SL y TP en `placeOrder`) y `:681-693` (helper `place()` de `setPositionTpSl` para Binance) hacen `await fetch(...)` **sin revisar `res.ok`** ni leer el body. `fetch` solo rechaza ante fallo de red; un rechazo del exchange (precio de stop inválido, "would trigger immediately", minNotional, rate limit) llega como un 400 normal y se ignora. `placeOrder` retorna `{ ok: true }` igualmente (línea 509).

*Escenario:* abres un long apalancado con SL activado. La entrada MARKET llena, el SL se rechaza porque el mark se movió entre la cotización y el envío. La app reporta éxito y no muestra ningún error. **La posición queda abierta y completamente desprotegida**, sin ninguna señal en pantalla. Es una inconsistencia, no un diseño: la pata de entrada (`:465-469`), `closePosition` (`:614-618`) y `modifyOrder` (`:579-584`) sí verifican `res.ok`.

**🔴 Crítico — `modifyOrder`, dos fallos distintos** (`src/lib/store/trading-store.ts:529-591`):

**(a) Pierde `positionIdx` al reponer.** El body de repost (líneas 563-572) no incluye `positionIdx`, a diferencia de `placeOrder` (`:445,484,502`), `closePosition` (`:611`) y `setPositionTpSl` (`:644`), que sí lo enhebran. Como `bybitPlaceOrder` solo lo agrega `if (a.positionIdx !== undefined)` (`bybit.ts:428`), se omite y Bybit rechaza con "position idx not match position mode" en cuenta hedge. **La orden original ya fue cancelada.** Peor: el camino de fallo (`:581-584`) setea `lastError` pero **no llama a `syncAccount`**, así que la lista cacheada puede seguir mostrando la orden cancelada hasta el siguiente tick — hasta 15s en ritmo idle en los que la UI miente activamente sobre un SL que ya no existe. Se dispara arrastrando la línea de una orden (`OrderLinesLayer.tsx:946`) o desde `EditOrderPopover` (`PositionsPanel.tsx:594`).

**(b) Usa `origQty` en vez del remanente sin llenar.** Línea 562: `const quantity = patch.quantity ?? order.origQty`. `EditOrderPopover` siembra el campo con `order.origQty` (`PositionsPanel.tsx:581,592`) y solo setea `patch.quantity` si el usuario lo cambia. Editar **solo el precio** de una orden límite parcialmente llena repone la cantidad original completa encima de lo ya llenado: una orden de 1 BTC llena al 40% pasa de 0.4 llenado + 0.6 pendiente a 0.4 llenado + 1.0 nuevo = hasta **1.4 BTC de exposición** contra 1.0 intencionada.

**🟠 Alto — `quickOrder` con cantidad rancia y agnóstica del símbolo.** `src/components/trading/BuySellOverlay.tsx:56-62` dispara un MARKET inmediato con `form.qty` **sin diálogo de confirmación**. `resetForm` (`trading-store.ts:240-250`) existe justamente para limpiar `qty` pero **nunca se llama en ningún lugar** del código; `qty` tampoco se persiste, pero dentro de una sesión sobrevive intacto al cambio de símbolo. Los botones Buy/Sell son visibles con el panel de orden colapsado (`:64-105`), así que la cantidad rancia no está en pantalla en el momento del doble clic. Configuras un tamaño en un símbolo, cambias el gráfico a otro mucho más caro, doble clic → orden de mercado a tamaño completo dimensionada para el instrumento equivocado.

**🟡 Medio — `cancelOrder` no revisa su respuesta.** `src/lib/store/trading-store.ts:516-527`: mismo patrón fire-and-forget, sin `lastError`. Consecuencia menor (orden "viva" que el usuario cree cancelada) pero es el mismo defecto de fondo.

**🟡 Medio — sin pre-chequeo de `minNotional` ni de leverage máximo.** `roundToStep` (`src/lib/trading/sizing.ts:23-26`) solo ajusta a `stepSize`; nada verifica `qty * price >= minNotional` antes de enviar, pese a que el dato está disponible (`bybit.ts:318`, `exchange-info/route.ts:99-100`, `symbol-info.ts:23`). En modos RISK_USD/RISK_PCT cerca del piso, `sizingToQty` (`sizing.ts:85-100`) puede calcular una cantidad bajo el mínimo sin ningún aviso en el panel.

**🟢 Bajo — `.toFixed()` con decimales fijos.** `src/components/trading/OrderPanel/OrderPanel.tsx:545,557` (`BidAskBar`) renderiza `bid.toFixed(2)`/`ask.toFixed(2)` ignorando `symInfo.pricePrecision`: en un símbolo sub-centavo muestra "0.00" en ambos lados, justo al lado de los botones Buy/Sell. No corrompe la orden (los campos de precio reales sí usan la precisión, líneas 248, 251, 262, 769, 838, 841) pero es una lectura de mercado materialmente engañosa. Similar en `:479-481` y `:697`. Los `.toFixed(2)` de `OrderLinesLayer.tsx` son valores en USD/porcentaje y están bien.

**🟢 Bajo — artefactos IEEE754 en `roundToStep`/`roundToTick`** (`sizing.ts:23-32`). La dirección siempre es conservadora para cantidad (nunca de más), así que no crea órdenes sobredimensionadas.

---

## 4. Integridad de datos

**🔴 Crítico — el camino de escritura no tiene gating de exchange.** Este es el hallazgo más importante de la auditoría y extiende el problema que CLAUDE.md ya documenta para lecturas. Todos los sitios de lectura están correctamente protegidos (`Watchlist.tsx:595-596`, `WatchlistScreen.tsx:468-470`, `OrderLinesLayer.tsx:702-704`, `BuySellOverlay.tsx:32-41`). Pero:

- `src/lib/store/trading-store.ts:396-470` (`placeOrder`) toma el símbolo del gráfico, hace `cleanSym(symbol)` y envía al exchange conectado. **No hay ningún `resolveSource(symbol).kind === exchange` en toda la función** (verificado leyendo el bloque completo).
- `src/components/trading/BuySellOverlay.tsx:56-62` llama `placeOrder` sin gating, aunque el mismo componente sí protege su bid/ask mostrado en la línea 32.
- `src/components/trading/OrderPanel/OrderPanel.tsx:336`: `onSubmit={() => placeOrder(symbol)}`, y el botón solo se deshabilita por `isLoading`/`!qty` (`:962-966`), nunca por mismatch de fuente.

*Escenario:* cuenta conectada a Binance, abres un ticker exclusivo de Bybit (alcanzable desde la búsqueda, porque `useBybitSymbols` registra todo el universo de perps de Bybit). El overlay muestra correctamente el bid/ask de Bybit. Doble clic en Buy esperando ejecución en Bybit → la orden se coloca **en Binance** sobre `cleanSym(symbol)`: otro libro, otro precio, o un 400 si ni siquiera cotiza allí.

**🟠 Alto — la precisión también sale del venue equivocado** (misma raíz). `useSymbolInfo` (`src/lib/trading/symbol-info.ts:64-87`) resuelve con `useTradingStore((s) => s.exchange)` — la cuenta conectada — no con `resolveSource(symbol).kind`. Ese valor alimenta el redondeo de precio en `OrderLinesLayer.tsx:684` y `OrderPanel.tsx:143,356`, que se vuelca a `updateForm({price/tp/sl})` (`OrderLinesLayer.tsx:845,867,880,889,900,911`). El caché en sí es correcto (clave `${cleanSymbol}|${testnet}|${exchange}`, línea 11/39, sin colisión ni staleness al cambiar de exchange) — el bug es la entrada, no la caché.

**🟠 Alto — Bybit sustituye 8h/3d en silencio.** `src/lib/bybit/public.ts:12-27`: Bybit no tiene intervalo 8h ni 3d, así que `"8h"` degrada a `"240"` (4h) y `"3d"` a `"D"` (1 día), tanto en REST (`:33`) como en WS (`src/lib/bybit/ws.ts:66`). Nada río abajo compensa: `timeframeToSeconds` sigue devolviendo 28800 y 259200 (`src/lib/chart/coords.ts:22,25`) y `BarCountdown.tsx:76` usa el timeframe declarado. `TimeframeSelector.tsx:10-35` ofrece 8h/3d sin condicionar por fuente. Resultado: en un símbolo Bybit a "8h" el gráfico muestra el doble de barras de las que implica el timeframe, y el countdown puede marcar hasta ~4h restantes sobre una vela que ya cerró y fue reemplazada.

**🟢 Bajo — `isFinal` inconsistente.** Presente en ambos caminos de Binance (`rest.ts:40`, `ws.ts:142`) y en el WS de Bybit (`ws.ts:127`), ausente en el REST de Bybit (`public.ts:69-76`). Hoy nadie lo lee fuera de tests, pero es una mina para el primer consumidor que confíe en él.

**Verificado correcto:** `snapToOHLC` solo se llama desde `snap.ts` (ningún bypass de `magnet.ts`); los tres sitios de `SUB_PANE_KEYS` están sincronizados y OBV ya está cableado en los tres (`PriceChart.tsx:1148,1365,335,3055,1831,1852,3086`) — la deriva histórica está corregida; los únicos dos consumidores de ticks que renderizan listas pasan por `useBatchedTicks`; toda la aritmética de calendario usa getters UTC (`keylevels.ts:35-67`, `indicators/index.ts:210-227`); Binance y Bybit normalizan a la misma forma `Candle` (tiempo en segundos, volumen en base); y Volume Profile implementa exactamente el reparto proporcional por solapamiento (`volume-profile.ts:104-121`) y la expansión de dos filas del área de valor (`:169-199`).

---

## 5. Arquitectura y límites cliente/servidor

- **Frontera bien trazada.** 105 archivos con `'use client'` sobre 174 no-test (~60%), coherente con la filosofía declarada. Todo el HMAC vive solo en servidor: `src/app/api/trade/order/route.ts:17,72,111`, `leverage/route.ts:10,63`, `src/lib/exchanges/account.ts:1,45-61`. **Cero código de firma en `src/components/` o hooks.**
- **El olor de diseño real** es que el secreto se materializa en el navegador y viaja en cada acción (leído en `OrderPanel.tsx:127`, `ApiKeyDialog.tsx:9`, `FloatingContextToolbar.tsx:442`, `TradeScreen.tsx:25`, `PositionsPanel.tsx:21`, `useTradingSync.ts:54`). No viola la frontera, pero convierte cualquier XSS de "leer un valor" en "toma de control de la cuenta de trading".
- **Zustand persist:** `chart-store` (`:1375-1413`) y `mobile-store` (`:38-39`) persisten solo preferencias, correcto. `alerts-store.ts:43-67` es el único **sin `partialize`** — hoy inofensivo (JSON.stringify descarta funciones) pero frágil si alguien agrega un campo sensible sin notarlo. `drawings-store` no persiste (va a Supabase). El problema es `trading-store`, ya cubierto en §2.2.
- **Dependencias:** notablemente limpias — una sola librería de gráficos, sin duplicación de librerías de fechas, sin lodash. Única anomalía: `"shadcn": "^4.7.0"` está en `dependencies` (`package.json:20`) sin importarse nunca desde `src/`; es un CLI generador y debería estar en `devDependencies` o eliminarse.
- **Deuda técnica:** **cero** TODO/FIXME/HACK/XXX en todo `src/`, y **cero** `: any` / `as any` en `src/lib/trading/`, `src/lib/exchanges/` y `src/app/api/trade/`. Los caminos financieros están tipados de verdad — esto es una fortaleza genuina y poco común.

---

## 6. Tests

23 archivos `*.test.ts`. Bien cubiertos: `sizing.ts`, `bybit.ts` (mappers), `countdown.ts`, `source.ts`, `volume-profile.ts`, indicadores principales, geometría/fib/duplicate/translate de dibujos, stores de chart/drawings/replay.

| Módulo | ¿Test? | Riesgo si no |
|---|---|---|
| `src/lib/exchanges/account.ts` (265 líneas) | **No** | **Alto.** Capa compartida de normalización detrás de `/api/trade/{balance,orders,positions,sync}`. La lógica pura de balance (`:95-122`: `free = availableBalance`, `locked = balance - availableBalance`) no tiene ni una aserción. Una regresión aquí falsea el balance disponible en ambos exchanges. Es el módulo puro sin cobertura de mayor impacto financiero. |
| `src/lib/trading/symbol-info.ts` | **No** | Medio-alto. `cleanSymbol` y el fallback `DEFAULT_SYMBOL_INFO` alimentan la precisión de redondeo de órdenes. |
| `src/lib/drawings/serialize.ts` | **No** | Medio. `drawingToRow`/`rowToDrawing` (`:9,29`) es la frontera de persistencia a Supabase; un mapeo de campo roto corrompe dibujos guardados sin que nada lo detecte. |
| `src/lib/symbols/prefix.ts`, `catalog.ts` | **No** | Medio. `prefix.ts` alimenta decisiones de ruteo de órdenes (§4). |
| `src/lib/indicators/vumanchu.ts` (301 líneas), `keylevels.ts` (239) | **No** | Medio. Los dos indicadores grandes sin cobertura; error de cálculo desinforma decisiones sin tocar ejecución. |
| `src/lib/chart/magnet.ts`, `src/lib/history/index.ts` | **No** | Bajo-medio, nivel UX. |
| `snap.ts`, `alert-eval.ts` | Sí, pero mal ubicados | Bajo. Cubiertos desde `coords-snap.test.ts`/`snap-drawings.test.ts` y `src/hooks/alert-logic.test.ts` — rompen la convención "test junto al código". |

**Hueco transversal:** ninguno de los bugs críticos de §3 tiene test. `placeOrder`, `modifyOrder` y `cancelOrder` viven en el store y son testeables con un `fetch` mockeado bajo el runner actual — no hace falta DOM.

---

## 7. Top 10 hallazgos priorizados

| # | Sev. | Archivo:línea | Qué hacer |
|---|---|---|---|
| 1 | **Crítico** | `trading-store.ts:473-505`, `:681-693` | Verificar `res.ok` en las patas TP/SL y propagar el fallo. Si el SL se rechaza tras una entrada llena, avisar en pantalla de forma prominente — hoy una posición apalancada queda sin stop y la app dice "éxito". |
| 2 | **Crítico** | `trading-store.ts:396-470`, `BuySellOverlay.tsx:56-62`, `OrderPanel.tsx:336` | Añadir `resolveSource(symbol).kind === exchange` antes de colocar; deshabilitar Buy/Sell con mensaje explícito ante mismatch. Evita enrutar al venue equivocado. |
| 3 | **Crítico** | `trading-store.ts:563-572` | Incluir `positionIdx` en el repost de `modifyOrder` (agregarlo a `Order` en `trading-types.ts:19-35`). Hoy en cuenta hedge Bybit cancela y el repost se rechaza. |
| 4 | **Crítico** | `trading-store.ts:562` | Usar el remanente (`origQty - executedQty`), no `origQty`, al reponer. Editar el precio de una orden parcialmente llena hoy infla la exposición. |
| 5 | **Alto** | `trading-store.ts:581-584` | Llamar `syncAccount` también en el camino de fallo del repost, para que la UI deje de mostrar una orden ya cancelada durante hasta 15s. |
| 6 | **Alto** | `trading-store.ts:256-373`, `account.ts:253-265` | Mover las lecturas de cuenta de GET+query string a POST+body. La clave y el secreto se están escribiendo en logs cada 2 segundos. |
| 7 | **Alto** | `BuySellOverlay.tsx:56-62` | Llamar `resetForm` al cambiar de símbolo (existe en `:240-250` y nunca se usa) y/o mostrar la cantidad en el botón de quick order. |
| 8 | **Alto** | `symbol-info.ts:64-87` | Derivar el exchange de `resolveSource(symbol).kind`, no de la cuenta conectada, para que tick/step size vengan del venue correcto. |
| 9 | **Alto** | `bybit/public.ts:12-27` | Ocultar 8h/3d en `TimeframeSelector` para fuentes Bybit, o etiquetar la sustitución. Hoy la granularidad mostrada y el countdown son falsos en silencio. |
| 10 | **Medio** | `auth/callback/route.ts:7,13` | Validar `next` (`startsWith("/") && !startsWith("//")` y sin `@`) o usar `new URL(next, origin)`. Open redirect sobre usuario recién autenticado. |

**Justo debajo del top 10, por orden:** cobertura de tests para `exchanges/account.ts` (§6), cifrado o mitigación documentada del secreto en localStorage (`trading-store.ts:739-742`), rate limiting en `/api/trade/order` y `/auth/callback`, cota de leverage (`leverage/route.ts:35`), pre-chequeo de `minNotional`, `res.ok` en `cancelOrder`, y `bid/ask.toFixed(2)` en `OrderPanel.tsx:545,557`.

Nada se editó — auditoría estrictamente de lectura, como pediste. Si quieres, puedo abrir los cuatro hallazgos críticos como tareas o preparar los parches del #1 al #4, que son los que tocan dinero directamente.