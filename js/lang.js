/* English / Español for the HCTRA Toll Calculator.
   I18N.t("English text with {name}", { name: ... }) returns the Spanish when Spanish is on.
   Fixed page text is swapped in place by I18N.apply(); the app re-renders what it builds.
   Toll point names, road names and EZ TAG stay as they are. The debug view stays in English. */
(function (root) {
  "use strict";
  var ES = {
    // ---- page ----
    "HCTRA Toll Calculator": "Calculadora de peajes de HCTRA",
    "See what the tolls cost on the fastest route, and how much time they save over a toll-free route.":
      "Vea cuánto cuestan los peajes en la ruta más rápida y cuánto tiempo ahorran frente a una ruta sin peaje.",
    "No ArcGIS API key yet. Add it as the ARCGIS_API_KEY secret on GitHub to turn on the map, address search and routing.":
      "Aún no hay clave de ArcGIS. Agréguela como el secreto ARCGIS_API_KEY en GitHub para activar el mapa, la búsqueda y las rutas.",
    "Your trip": "Su viaje",
    "Start over": "Empezar de nuevo",
    "From": "Desde",
    "To": "Hasta",
    "Pick on map": "Elegir en el mapa",
    "Tap the map…": "Toque el mapa…",
    "Choose a place…": "Elija un lugar…",
    "Save place": "Guardar lugar",
    "Leave": "Salida",
    "Blank = now": "En blanco = ahora",
    "Your vehicle and tag": "Su vehículo y TAG",
    "My vehicles…": "Mis vehículos…",
    "Save vehicle": "Guardar vehículo",
    "How do you pay tolls?": "¿Cómo paga los peajes?",
    "Other tag": "Otro TAG",
    "TxTag, TollTag": "TxTag, TollTag",
    "No tag": "Sin TAG",
    "Pay by mail": "Pago por correo",
    "Pick one: no-tag tolls can cost much more.": "Elija uno: sin TAG los peajes pueden costar mucho más.",
    "Vehicle": "Vehículo",
    "2 axles (car, SUV)": "2 ejes (auto, SUV)",
    "3 axles": "3 ejes", "4 axles": "4 ejes", "5 axles (18-wheeler)": "5 ejes (tráiler)", "6 axles": "6 ejes", "7 axles": "7 ejes",
    "8 or more axles": "8 o más ejes",
    "Carpool (2+) or motorcycle": "Viaje compartido (2+) o motocicleta",
    "Free on the Katy Managed Lanes during HOV hours": "Gratis en los carriles administrados de Katy en horario HOV",
    "Compare toll and toll-free routes": "Comparar rutas con y sin peaje",
    "Toll route": "Ruta con peaje",
    "Toll-free route": "Ruta sin peaje",
    "Show on map": "Ver en el mapa",
    "Share trip": "Compartir viaje",
    "Miles per gallon": "Millas por galón",
    "Price per gallon": "Precio por galón",
    "Use defaults": "Valores predeterminados",
    "Toll breakdown": "Detalle de peajes",
    "Tap a toll point to find it on the map. Tap it again, or tap the map, to clear.":
      "Toque un punto de peaje para verlo en el mapa. Tóquelo otra vez, o toque el mapa, para quitarlo.",
    "Toll point": "Punto de peaje",
    "Road": "Vía",
    "Toll": "Peaje",
    "Commute cost": "Costo de ir al trabajo",
    "Days a week": "Días por semana",
    "Round trip": "Ida y vuelta",
    "Best time to leave": "Mejor hora para salir",
    "Compare leaving earlier or later: trip time, tolls and time saved for each. Uses about a dozen route lookups.":
      "Compare salir más temprano o más tarde: tiempo de viaje, peajes y tiempo ahorrado en cada caso. Usa una docena de consultas de ruta.",
    "Compare departure times": "Comparar horas de salida",
    "Estimates only. Houston-area rates checked Oct 20–22, 2026 against HCTRA, Montgomery, Fort Bend and Brazoria counties, and TxDOT (Grand Parkway, SH 249, SH 288). Katy Managed Lanes use HCTRA's 2013 schedule, still current. Pay-by-mail fees aren't included.":
      "Solo estimaciones. Tarifas del área de Houston verificadas del 20 al 22 de oct. de 2026 con HCTRA, los condados de Montgomery, Fort Bend y Brazoria, y TxDOT (Grand Parkway, SH 249, SH 288). Los carriles administrados de Katy usan la tabla de HCTRA de 2013, aún vigente. No incluye cargos del pago por correo.",
    "Edit my places": "Editar mis lugares",
    "Saved and recent places are kept in this browser only.": "Los lugares guardados y recientes se quedan solo en este navegador.",
    "My places": "Mis lugares",
    "Recent": "Recientes",
    "Clear recent": "Borrar recientes",
    "Done": "Listo",
    "Edit my vehicles": "Editar mis vehículos",
    "Saved vehicles are kept in this browser only.": "Los vehículos guardados se quedan solo en este navegador.",
    "Saved, recent and common places for From": "Lugares guardados, recientes y comunes para Desde",
    "Saved, recent and common places for To": "Lugares guardados, recientes y comunes para Hasta",
    "My saved vehicles": "Mis vehículos guardados",
    "Trip chart": "Gráfica del viaje",
    "Starting address": "Dirección de salida",
    "Destination": "Destino",
    "Base map": "Mapa base",
    "Light": "Claro", "Streets": "Calles", "Satellite": "Satélite", "Dark": "Oscuro",
    "Toll point details": "Detalles del punto de peaje",
    "Show on map ": "Ver en el mapa",
    // ---- places and vehicles ----
    "Common places": "Lugares comunes",
    "Manage": "Administrar",
    "My saved places": "Mis lugares guardados",
    "Recent places": "Lugares recientes",
    "Edit my places and recent…": "Editar mis lugares y recientes…",
    "Remove": "Quitar",
    "No saved places. Use “Save place” under From or To to add one.": "No hay lugares guardados. Use “Guardar lugar” debajo de Desde o Hasta para agregar uno.",
    "{n} recent place": "{n} lugar reciente",
    "{n} recent places": "{n} lugares recientes",
    "No recent places": "No hay lugares recientes",
    "Name this place (for example, Home or Work):": "Nombre para este lugar (por ejemplo, Casa o Trabajo):",
    "Saved “{name}” to My places on this device.": "Se guardó “{name}” en Mis lugares en este dispositivo.",
    "Tap the map to set the start.": "Toque el mapa para fijar la salida.",
    "Tap the map to set the destination.": "Toque el mapa para fijar el destino.",
    "Dropped pin ({label})": "Punto marcado ({label})",
    "Couldn't load the toll data.": "No se pudieron cargar los datos de peaje.",
    "Rates as of {date}": "Tarifas al {date}",
    " · SH 288 time-of-day rates effective {date}": " · Tarifas por hora de SH 288 vigentes desde {date}",
    "Edit my vehicles…": "Editar mis vehículos…",
    "Name this vehicle (for example, My truck or Work van):": "Nombre para este vehículo (por ejemplo, Mi camioneta o Van del trabajo):",
    "{n}-axle truck": "Camión de {n} ejes",
    "My car": "Mi auto",
    "Saved “{name}” ({summary}) to My vehicles on this device.": "Se guardó “{name}” ({summary}) en Mis vehículos en este dispositivo.",
    "No saved vehicles. Set the vehicle and tag, then tap “Save vehicle”.": "No hay vehículos guardados. Elija el vehículo y el TAG, luego toque “Guardar vehículo”.",
    "{n} axles": "{n} ejes",
    "carpool": "viaje compartido",
    "Using “{name}”.": "Usando “{name}”.",
    // ---- routing status ----
    "Finding routes…": "Buscando rutas…",
    "Keeping the toll route on the tollway…": "Manteniendo la ruta con peaje en la autopista…",
    "Keeping the toll-free route on the feeder road…": "Manteniendo la ruta sin peaje en la lateral…",
    "Couldn't get routes: {msg}": "No se pudieron obtener las rutas: {msg}",
    "unknown error": "error desconocido",
    "Repriced for {what} on the same route.": "Recalculado para {what} en la misma ruta.",
    "Repriced for {what} on the truck route. ": "Recalculado para {what} en la ruta de camión. ",
    "Repriced for {what} on the car route. ": "Recalculado para {what} en la ruta de auto. ",
    "Trucks can be routed differently. ": "Los camiones pueden tener otra ruta. ",
    "Cars can take a different route. ": "Los autos pueden tomar otra ruta. ",
    "Find the truck route": "Buscar la ruta de camión",
    "Find the car route": "Buscar la ruta de auto",
    "another toll tag": "otro TAG",
    "no tag": "sin TAG",
    // ---- results ----
    "No tolls on this trip": "Este viaje no tiene peajes",
    "The fastest route is already toll-free.": "La ruta más rápida ya es sin peaje.",
    "{price} for the managed lanes": "{price} por los carriles administrados",
    "Time saved isn't estimated: the lanes are usually faster at rush hour.": "No se estima el tiempo ahorrado: los carriles suelen ser más rápidos en hora pico.",
    "Save {time} for {price}": "Ahorre {time} por {price}",
    "About {cost} per minute saved.": "Unos {cost} por minuto ahorrado.",
    "Skip the tolls": "Evite los peajes",
    "The toll route is about {time} slower right now.": "La ruta con peaje es unos {time} más lenta ahora.",
    "The toll-free route is about as fast right now.": "La ruta sin peaje es casi igual de rápida ahora.",
    "With EZ TAG": "Con EZ TAG",
    "Save {amount}": "Ahorre {amount}",
    "Get an EZ TAG →": "Obtenga un EZ TAG →",
    "No toll points crossed.": "No se cruza ningún punto de peaje.",
    "(unverified)": "(sin verificar)",
    "Some time-of-day tolls (Katy Managed Lanes or SH 288 Express Lanes) couldn't be priced, so the total is low.":
      "Algunos peajes por hora (carriles administrados de Katy o carriles exprés de SH 288) no se pudieron calcular, así que el total está bajo.",
    "Your route runs alongside the Katy Managed Lanes or SH 288 Express Lanes. The toll route includes their tolls for that stretch; the toll-free route stays in the regular lanes.":
      "Su ruta va junto a los carriles administrados de Katy o los carriles exprés de SH 288. La ruta con peaje incluye sus peajes en ese tramo; la ruta sin peaje se queda en los carriles normales.",
    "Katy Managed Lanes and SH 288 Express Lanes charge by time of day. These are priced for when you'd reach each gantry, leaving {when}.":
      "Los carriles administrados de Katy y los carriles exprés de SH 288 cobran según la hora. El precio es para cuando llegaría a cada pórtico, saliendo {when}.",
    "now ({time})": "ahora ({time})",
    "at {time}": "a las {time}",
    "{n} toll point(s) on this route have no rate for this vehicle in the data, so the total is low.":
      "{n} punto(s) de peaje en esta ruta no tienen tarifa para este vehículo en los datos, así que el total está bajo.",
    "Esri's toll-free route leaves the {road} feeder road and comes back to it (via {via}), even when steered back. Esri's map may be missing part of the feeder road here, so the toll-free time may be a little long.":
      "La ruta sin peaje de Esri sale de la lateral de {road} y regresa a ella (por {via}), aun al corregirla. Puede que al mapa de Esri le falte parte de la lateral aquí, así que el tiempo sin peaje puede estar un poco alto.",
    "Esri's fastest toll-free route left the feeder road for side streets ({via}) and came back. Drivers usually stay on the feeder road, so the toll-free route here does too.":
      "La ruta sin peaje más rápida de Esri dejó la lateral por calles ({via}) y regresó. Los conductores suelen seguir en la lateral, así que la ruta sin peaje aquí también.",
    "Esri's toll route still gets off the {road} and back on (via {via}), even after re-routing. Most drivers stay on the tollway, so the real trip may run a little differently.":
      "La ruta con peaje de Esri todavía sale de {road} y vuelve a entrar (por {via}), aun después de corregirla. La mayoría de los conductores se quedan en la autopista, así que el viaje real puede variar un poco.",
    "Esri's fastest toll route got off the {road} onto the frontage road or side streets and back on again (to dodge traffic or a toll). Most drivers stay on unless there's a crash or closure, so the toll route here stays on the tollway.":
      "La ruta con peaje más rápida de Esri salió de {road} a la lateral o a calles y volvió a entrar (para evitar tráfico o un peaje). La mayoría se queda en la autopista salvo que haya un choque o cierre, así que aquí la ruta con peaje sigue en la autopista.",
    "the {road} frontage road": "la lateral de {road}",
    "{n} Fort Bend County toll point(s) on this route publish rates only up to 6 axles, so they're priced at the 6-axle rate.":
      "{n} punto(s) de peaje del condado de Fort Bend en esta ruta publican tarifas solo hasta 6 ejes, así que se cobran a la tarifa de 6 ejes.",
    "{n} toll point(s) on this route haven't been checked against their agency's published rates yet.":
      "{n} punto(s) de peaje en esta ruta aún no se han verificado con las tarifas publicadas de su agencia.",
    "Your toll": "Su peaje",
    "Not included": "No incluido",
    "rate not included": "tarifa no incluida",
    "Mainline": "Vía principal",
    "Entrance ramp": "Rampa de entrada",
    "Exit ramp": "Rampa de salida",
    "Rate checked against {owner}’s published schedule.": "Tarifa verificada con la tabla publicada de {owner}.",
    "Priced by time of day": "Precio según la hora",
    " for about {time}": " para alrededor de las {time}",
    "This rate hasn’t been checked against {owner}’s published schedule yet.": "Esta tarifa aún no se ha verificado con la tabla publicada de {owner}.",
    " Fort Bend publishes rates up to 6 axles; 7+ axles are priced at the 6-axle rate.": " Fort Bend publica tarifas hasta 6 ejes; 7 o más ejes se cobran a la tarifa de 6 ejes.",
    "Northbound": "Hacia el norte", "Southbound": "Hacia el sur", "Eastbound": "Hacia el este", "Westbound": "Hacia el oeste",
    // ---- trip chart ----
    "Trip chart: toll route {tt}, {price}; toll-free route {ft}": "Gráfica del viaje: ruta con peaje {tt}, {price}; ruta sin peaje {ft}",
    "Toll route · {time} · {price}": "Con peaje · {time} · {price}",
    "Toll-free · {time} · $0.00": "Sin peaje · {time} · $0.00",
    "Managed lanes · traffic not shown": "Carriles administrados · sin tráfico",
    "Highway traffic:": "Tráfico en autopista:",
    "Moderate": "Moderado", "Slow": "Lento", "Heavy": "Pesado",
    "{level} traffic, about {mph} mph": "Tráfico {level}, unas {mph} mph",
    "moderate": "moderado", "slow": "lento", "heavy": "pesado", "closed": "cerrado",
    "No traffic colors on long stretches: Esri gives one average speed for {miles} mi of {road}, too coarse to show where it's slow. The trip time still includes traffic.":
      "Sin colores de tráfico en tramos largos: Esri da una sola velocidad promedio para {miles} mi de {road}, muy general para mostrar dónde está lento. El tiempo del viaje sí incluye el tráfico.",
    "the highway": "la autopista",
    // ---- gas, commute, best time, share ----
    "Gas, counting traffic: about the same on both routes ({cost})": "Gasolina, contando el tráfico: casi igual en ambas rutas ({cost})",
    "Gas, counting traffic: the toll route uses about {cost} more ({toll} vs {free})": "Gasolina, contando el tráfico: la ruta con peaje gasta unos {cost} más ({toll} vs {free})",
    "Gas, counting traffic: the toll route saves about {cost} ({toll} vs {free})": "Gasolina, contando el tráfico: la ruta con peaje ahorra unos {cost} ({toll} vs {free})",
    "{mpg} mpg, {price}/gal {fuel}": "{mpg} mpg, {price}/gal {fuel}",
    "regular": "regular", "diesel": "diésel",
    "change": "cambiar",
    "{n} trips a week": "{n} viajes por semana",
    "Week": "Semana", "Month": "Mes",
    "Tolls": "Peajes",
    "Time saved": "Tiempo ahorrado",
    "Extra gas on the toll route": "Gasolina extra en la ruta con peaje",
    "Gas saved on the toll route": "Gasolina ahorrada en la ruta con peaje",
    "Tolls plus extra gas": "Peajes más gasolina extra",
    "Tolls minus gas saved": "Peajes menos gasolina ahorrada",
    "Assumes the trip back costs the same and every trip matches this one (same time of day and traffic). A month is about 4.3 weeks.":
      "Supone que el regreso cuesta lo mismo y que cada viaje es igual a este (misma hora y tráfico). Un mes son unas 4.3 semanas.",
    "Assumes every trip matches this one (same time of day and traffic). A month is about 4.3 weeks.":
      "Supone que cada viaje es igual a este (misma hora y tráfico). Un mes son unas 4.3 semanas.",
    "Checking {n} departure times…": "Revisando {n} horas de salida…",
    "Toll-free": "Sin peaje",
    "Saves": "Ahorra",
    "Fastest": "Más rápida",
    "Your time": "Su hora",
    "Live traffic up to about 4 hours ahead; later times use typical traffic for that day and time.":
      "Tráfico en vivo hasta unas 4 horas adelante; después se usa el tráfico típico para ese día y hora.",
    "* Esri’s route leaves the tollway at this time, so this toll may be low.": "* La ruta de Esri sale de la autopista a esta hora, así que este peaje puede estar bajo.",
    "Cheapest": "Más barata",
    "Couldn’t check this time": "No se pudo revisar esta hora",
    "Shaded row: the time you picked. Live traffic up to about 4 hours ahead; later times use typical traffic for that day and time.":
      "Fila sombreada: la hora que eligió. Tráfico en vivo hasta unas 4 horas adelante; después se usa el tráfico típico para ese día y hora.",
    " Tolls on this route don’t change with the time of day.": " Los peajes de esta ruta no cambian según la hora.",
    "Link copied. Paste it anywhere to share this trip.": "Enlace copiado. Péguelo donde quiera para compartir este viaje.",
    "Copy this link:": "Copie este enlace:",
    "Shared start": "Salida compartida",
    "Shared destination": "Destino compartido",
    "Español": "English"
  };

  var params = new URLSearchParams(location.search);
  var stored = null;
  try { stored = localStorage.getItem("htc-lang"); } catch (e) { /* not kept */ }
  var lang = params.get("lang") === "es" || params.get("lang") === "en" ? params.get("lang") : stored === "es" ? "es" : "en";

  function t(en, vars) {
    var s = lang === "es" && Object.prototype.hasOwnProperty.call(ES, en) ? ES[en] : en;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] == null ? m : vars[k]; });
    return s;
  }

  // Fixed page text: remember each node's English and swap it in place.
  var original = new WeakMap(), ATTRS = ["aria-label", "placeholder", "title", "label"];
  function norm(s) { return s.replace(/\s+/g, " ").trim(); }
  function skip(el) { return el.closest && el.closest("#debug, .esri-ui, .esri-view-surface, script, style, svg, #map .esri-attribution"); }
  function apply(rootEl) {
    rootEl = rootEl || document.body;
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null), node, list = [];
    while ((node = walker.nextNode())) list.push(node);
    list.forEach(function (n) {
      if (!n.parentElement || skip(n.parentElement)) return;
      if (!original.has(n)) { var k = norm(n.nodeValue); if (!k || !ES[k]) return; original.set(n, { text: k, raw: n.nodeValue }); }
      var o = original.get(n);
      n.nodeValue = lang === "es" ? n.nodeValue.replace(/\S[\s\S]*\S|\S/, ES[o.text]) : o.raw;
    });
    Array.prototype.forEach.call(rootEl.querySelectorAll("*"), function (el) {
      if (skip(el)) return;
      ATTRS.forEach(function (a) {
        var key = "data-en-" + a, v = el.getAttribute(a);
        if (v == null) return;
        var en = el.getAttribute(key);
        if (en == null) { if (!ES[norm(v)]) return; el.setAttribute(key, v); en = v; }
        el.setAttribute(a, lang === "es" ? ES[norm(en)] : en);
      });
    });
    document.documentElement.lang = lang;
    document.title = t("HCTRA Toll Calculator");
  }

  var listeners = [];
  function setLang(l) {
    lang = l === "es" ? "es" : "en";
    try { localStorage.setItem("htc-lang", lang); } catch (e) { /* not kept */ }
    apply();
    listeners.forEach(function (f) { try { f(lang); } catch (e) { console.warn(e); } });
  }
  root.I18N = {
    t: t, apply: apply, setLang: setLang,
    get lang() { return lang; },
    locale: function () { return lang === "es" ? "es-US" : "en-US"; },
    onChange: function (f) { listeners.push(f); },
    ES: ES
  };
})(this);
