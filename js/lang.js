/* Languages for the Toll Calculator: English, Español, Tiếng Việt, 简体中文, 繁體中文.
   I18N.t("English text with {name}", { name: ... }) returns the text in the language that's on.
   Fixed page text is swapped in place by I18N.apply(); the app re-renders what it builds.
   Spanish is in this file (the key list: every translatable string is a key in ES). Vietnamese and
   Chinese load on demand from js/lang-vi.js, js/lang-zh-hans.js and js/lang-zh-hant.js, which
   call I18N.add(code, { english: translation }); a string missing there shows in English.
   Toll point names, road names and EZ TAG stay as they are. The debug view stays in English. */
(function (root) {
  "use strict";
  var ES = {
    // ---- page ----
    "Toll Calculator": "Calculadora de peajes",
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
    "Departure time": "Hora de salida",
    "Departure": "Hora",
    "Blank = now": "En blanco = ahora",
    "Now": "Ahora",
    "Leave date": "Fecha de salida",
    "Leave time": "Hora de salida",
    "Your vehicle and tag": "Su vehículo y TAG",
    "My vehicles…": "Mis vehículos…",
    "Save vehicle": "Guardar vehículo",
    "How do you pay tolls?": "¿Cómo paga los peajes?",
    "Other tag": "Otro TAG",
    "TxTag, TollTag": "TxTag, TollTag",
    "No tag": "Sin TAG",
    "Pay by mail": "Pago por correo",
    "No-tag tolls can cost much more.": "Sin TAG, los peajes pueden costar mucho más.",
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
    "Email": "Correo",
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
    "Estimates only. Houston-area rates checked Oct 20–22, 2026 against HCTRA, Montgomery, Fort Bend and Brazoria counties, and TxDOT (Grand Parkway, SH 249, SH 288). Katy Managed Lanes use HCTRA's 2013 schedule, still current. Austin-area rates (TxDOT's SH 130, SH 45 and Loop 1, and SH 130 south of Mustang Ridge) checked Oct 24, 2026. Dallas-Fort Worth: NTTA roads (rates effective July 1, 2025) checked Oct 24, 2026; TEXpress lanes aren't included. Pay-by-mail fees aren't included.":
      "Solo estimaciones. Tarifas del área de Houston verificadas del 20 al 22 de oct. de 2026 con HCTRA, los condados de Montgomery, Fort Bend y Brazoria, y TxDOT (Grand Parkway, SH 249, SH 288). Los carriles administrados de Katy usan la tabla de HCTRA de 2013, aún vigente. Tarifas del área de Austin (SH 130, SH 45 y Loop 1 de TxDOT, y SH 130 al sur de Mustang Ridge) verificadas el 24 de oct. de 2026. Dallas-Fort Worth: vías de NTTA (tarifas vigentes desde el 1 de julio de 2025) verificadas el 24 de oct. de 2026; no incluye los carriles TEXpress. No incluye cargos del pago por correo.",
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
    "Tolls not included": "Peajes no incluidos",
    "This route uses {roads}. This calculator doesn't have those toll rates yet.": "Esta ruta usa {roads}. Esta calculadora todavía no tiene esas tarifas de peaje.",
    "The toll route uses {roads}. This calculator doesn't have toll rates for {them} yet, so the total leaves {them} out.": "La ruta con peaje usa {roads}. Esta calculadora todavía no tiene las tarifas de {them}, así que el total no las incluye.",
    "those roads": "esas vías",
    "that road": "esa vía",
    "The toll-free route uses {roads}, which charges a toll. This calculator doesn't have that rate yet.": "La ruta sin peaje usa {roads}, que cobra peaje. Esta calculadora todavía no tiene esa tarifa.",
    "and": "y",
    "No tolls on this trip": "Este viaje no tiene peajes",
    "The fastest route is already toll-free.": "La ruta más rápida ya es sin peaje.",
    "The fastest route doesn’t use a toll road. To compare one, pick it here.": "La ruta más rápida no usa autopistas de peaje. Para comparar una, elíjala aquí.",
    "{price} for the managed lanes": "{price} por los carriles administrados",
    "Time saved isn't estimated: the lanes are usually faster at rush hour.": "No se estima el tiempo ahorrado: los carriles suelen ser más rápidos en hora pico.",
    "Save {time} for {price}": "Ahorre {time} por {price}",
    "Every minute saved costs {cost}.": "Cada minuto ahorrado cuesta {cost}.",
    "Skip the tolls": "Evite los peajes",
    "The toll route is about {time} slower right now.": "La ruta con peaje es unos {time} más lenta ahora.",
    "The toll-free route is about as fast right now.": "La ruta sin peaje es casi igual de rápida ahora.",
    "With EZ TAG": "Con EZ TAG",
    "Save {amount}": "Ahorre {amount}",
    "Get an EZ TAG →": "Obtenga un EZ TAG →",
    "Added toll": "Peaje adicional",
    "added": "adicional",
    "not on this route": "no está en esta ruta",
    "Not on this route": "No está en esta ruta",
    "Save this place…": "Guardar este lugar…",
    "Save this vehicle…": "Guardar este vehículo…",
    "About carpool": "Acerca del viaje compartido",
    "Once a week, both ways": "Una vez a la semana, ida y vuelta",
    "Once a week, one way": "Una vez a la semana, solo ida",
    "{n} days a week, both ways": "{n} días a la semana, ida y vuelta",
    "{n} days a week, one way": "{n} días a la semana, solo ida",
    "About {amount} a month": "Unos {amount} al mes",
    "Save about {amount} a month with an EZ TAG": "Ahorre unos {amount} al mes con un EZ TAG",
    "Tolls only; gas costs the same with any tag.": "Solo peajes; la gasolina cuesta lo mismo con cualquier TAG.",
    "Get an EZ TAG at hctra.org": "Obtenga un EZ TAG en hctra.org",
    "No tag · by mail": "Sin TAG · por correo",
    "Your TxTag or TollTag": "Su TxTag o TollTag",
    "Save about {amount} a month": "Ahorre unos {amount} al mes",
    "if you drive this {n} days a week, both ways.": "si hace este viaje {n} días a la semana, ida y vuelta.",
    "if you drive this {n} days a week, one way.": "si hace este viaje {n} días a la semana, solo ida.",
    "if you drive this once a week, both ways.": "si hace este viaje una vez a la semana, ida y vuelta.",
    "if you drive this once a week, one way.": "si hace este viaje una vez a la semana, solo ida.",
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
    "Gas for this trip": "Gasolina para este viaje",
    "About the same gas on both routes.": "Casi la misma gasolina en ambas rutas.",
    "The toll route uses about {cost} more gas": "La ruta con peaje gasta unos {cost} más de gasolina",
    "The toll route uses about {cost} less gas": "La ruta con peaje gasta unos {cost} menos de gasolina",
    "it's {n} mi longer": "es {n} mi más larga",
    "it's {n} mi shorter": "es {n} mi más corta",
    "less stop-and-go": "menos tráfico de parar y arrancar",
    "it's {n} mi shorter, with less stop-and-go": "es {n} mi más corta y con menos tráfico de parar y arrancar",
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
    "Your results": "Sus resultados",
    "Report a wrong toll": "Reportar un peaje incorrecto",
    "Report this toll": "Reportar este peaje",
    "Coming back at": "Regreso a las",
    "Add to home screen": "Agregar a la pantalla de inicio",
    "Toll road": "Autopista de peaje",
    "Add a stop": "Agregar una parada",
    "Print": "Imprimir",
    "Save PDF": "Guardar PDF",
    "Houston area": "Área de Houston",
    "Austin area": "Área de Austin",
    "Toll roads": "Vías de peaje",
    "Dallas-Fort Worth area": "Área de Dallas-Fort Worth",
    " This stretch of SH 130 charges by vehicle size, not axles. For 3+ axles the app assumes: 3 = car with a trailer, 4 = larger vehicle, 5 = larger vehicle with a trailer, 6+ = more than one trailer.": " Este tramo de la SH 130 cobra según el tamaño del vehículo, no por ejes. Para 3 o más ejes la aplicación supone: 3 = auto con remolque, 4 = vehículo más grande, 5 = vehículo más grande con remolque, 6 o más = más de un remolque.",
    " New rates start {date}; your trip is priced for its own date.": " Las tarifas nuevas empiezan el {date}; su viaje se calcula para su propia fecha.",
    "This site counts visits and actions anonymously: no cookies, no addresses or routes.": "Este sitio cuenta visitas y acciones de forma anónima: sin cookies, sin direcciones ni rutas.",
    "Add stop here": "Agregar parada aquí",
    "Stop {n} added": "Parada {n} agregada",
    "Tip: with a start and end set, press and hold the map to add a stop there.": "Consejo: con la salida y el destino fijados, mantenga presionado el mapa para agregar una parada ahí.",
    "Add stops on map": "Agregar paradas en el mapa",
    "Done adding stops": "Listo con las paradas",
    "This trip already has {n} stops, the most allowed.": "Este viaje ya tiene {n} paradas, el máximo permitido.",
    "Tap the map to add stops, in the order you'll visit them (up to {n}). Tap Done when finished.": "Toque el mapa para agregar paradas, en el orden en que las visitará (hasta {n}). Toque Listo al terminar.",
    "Added stop {n}, the most allowed.": "Se agregó la parada {n}, el máximo permitido.",
    "Added stop {n}. Tap the map for the next stop, or tap Done.": "Se agregó la parada {n}. Toque el mapa para la siguiente parada o toque Listo.",
    "Your trip changed. Finding new routes…": "Su viaje cambió. Buscando rutas nuevas…",
    "The route doesn't go to Stop {n} ({place}): the map couldn't put that spot on a road it can drive to. Pick an address or a spot right on a street nearby, then compare again.": "La ruta no pasa por la parada {n} ({place}): el mapa no pudo ubicar ese punto en una vía por la que pueda manejar. Elija una dirección o un punto justo sobre una calle cercana y vuelva a comparar.",
    "On iPhone or iPad: in Safari, tap Share (the square with an arrow), then “Add to Home Screen”.": "En iPhone o iPad: en Safari, toque Compartir (el cuadro con una flecha) y luego “Agregar a la pantalla de inicio”.",
    "Making the PDF…": "Creando el PDF…",
    "The map picture couldn’t be made. Tap “Open this trip online” to see the map.": "No se pudo crear la imagen del mapa. Toque “Abrir este viaje en línea” para ver el mapa.",
    "Open this trip online": "Abrir este viaje en línea",
    "Opening the shared trip…": "Abriendo el viaje compartido…",
    "End": "Llegada",
    "Saved {name}.": "Se guardó {name}.",
    "Couldn't make the PDF. Try Print instead.": "No se pudo crear el PDF. Pruebe Imprimir.",
    "Finding a route on {road}…": "Buscando una ruta por {road}…",
    "Finding the fastest route…": "Buscando la ruta más rápida…",
    "Departure times checked": "Horas de salida revisadas",
    "{done} of {n}": "{done} de {n}",
    "Toll agencies on this route": "Agencias de peaje en esta ruta",
    "Each agency sets its own rates. Check any toll here against the agency’s published schedule.": "Cada agencia fija sus propias tarifas. Compare cualquier peaje con la tabla publicada por la agencia.",
    "{agency} rates on {site}": "Tarifas de {agency} en {site}",
    "{roads} rates": "Tarifas de {roads}",
    "Check their rates": "Ver sus tarifas",
    "Website": "Sitio web",
    "Stop {n} is on the {road}, so the toll-free route doesn't go there.": "La parada {n} está en la {road}, así que la ruta sin peaje no pasa por ahí.",
    "With live traffic, Esri's route gets off the {road} and back on. The toll route shown stays on the tollway, with Esri's traffic time for the trip.": "Con el tráfico en vivo, la ruta de Esri sale de la {road} y vuelve a entrar. La ruta con peaje que se muestra se queda en la autopista, con el tiempo de Esri con tráfico.",
    "Get an EZ TAG: hctra.org": "Obtenga un EZ TAG: hctra.org",
    "Check the agencies' rates:": "Tarifas de las agencias:",
    "Resize the panel": "Cambiar el ancho del panel",
    "Drag to resize the panel. Double-click to reset.": "Arrastre para cambiar el ancho del panel. Doble clic para restablecerlo.",
    "Rates": "Tarifas",
    "Rates {n}": "Tarifas {n}",
    "Tolls by agency:": "Peajes por agencia:",
    "1 toll point": "1 punto de peaje",
    "{n} toll points": "{n} puntos de peaje",
    "Check this rate on {site}": "Ver esta tarifa en {site}",
    "Rates:": "Tarifas:",
    "Gas and commute cost": "Costo de gasolina y del viaje diario",
    "Fuel price per gallon": "Precio del combustible por galón",
    "Based on {mpg} mpg and {price} a gallon ({fuel}).": "Calculado con {mpg} mpg y {price} por galón ({fuel}).",
    "Change these to match your vehicle. Defaults for {n} axles: {mpg} mpg, {price}/gal {fuel}.": "Cámbielos según su vehículo. Valores predeterminados para {n} ejes: {mpg} mpg, {price}/gal {fuel}.",
    "Trip summary": "Resumen del viaje",
    "Trip": "Viaje",
    "carpool": "viaje compartido",
    "Start": "Salida",
    "Map of the toll route and toll-free route": "Mapa de la ruta con peaje y la ruta sin peaje",
    "Open this trip:": "Abrir este viaje:",
    "Printed {date}. Estimates only; rates and traffic change.": "Impreso el {date}. Solo son estimaciones; las tarifas y el tráfico cambian.",
    "Stop {n}": "Parada {n}",
    "Remove stop {n}": "Quitar la parada {n}",
    "Stop address": "Dirección de la parada",
    "Saved, recent and common places for Stop {n}": "Lugares guardados, recientes y comunes para la parada {n}",
    "Tap the map to set this stop.": "Toque el mapa para fijar esta parada.",
    "Apple Maps and Waze open with the destination only; add your stops there.": "Apple Maps y Waze abren solo con el destino; agregue sus paradas ahí.",
    "Fastest (any toll road)": "La más rápida (cualquier autopista)",
    "Use {road}": "Usar {road}",
    "Routed through the {name} plaza on {road}.": "La ruta pasa por la plaza {name} en {road}.",
    "Couldn’t keep the route on {road}. Try “Fastest” instead.": "No se pudo mantener la ruta en {road}. Pruebe “La más rápida”.",
    "Price the trip back": "Calcular el regreso",
    "Routing the trip back…": "Calculando la ruta de regreso…",
    "Couldn’t route the trip back. Try again in a moment.": "No se pudo calcular el regreso. Inténtelo de nuevo en un momento.",
    "Trip back at {time}: {toll} in tolls. Toll route {tt}, toll-free {ft}.": "Regreso a las {time}: {toll} en peajes. Ruta con peaje {tt}, sin peaje {ft}.",
    "Esri’s route leaves the tollway at this time, so this toll may be low.": "La ruta de Esri sale de la autopista a esta hora, así que este peaje podría ser bajo.",
    "Uses this trip there and the trip back priced for {time}, every day the same. A month is about 4.3 weeks.": "Usa este viaje de ida y el regreso calculado para las {time}, igual todos los días. Un mes son unas 4.3 semanas.",
    "What looks wrong? (For example: the price, a toll that is missing, or one that shouldn't be there.)": "¿Qué parece incorrecto? (Por ejemplo: el precio, un peaje que falta o uno que no debería estar.)",
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
    "Drive it:": "Manejar:",
    "Route to open": "Ruta para abrir",
    "Google Maps follows this route through a few points. Apple Maps and Waze pick their own roads: turn on “Avoid tolls” there to stay toll-free.":
      "Google Maps sigue esta ruta por algunos puntos. Apple Maps y Waze eligen sus propias vías: active “Evitar peajes” ahí para no pagar peaje.",
    "Google Maps follows this route through a few points on it. Apple Maps and Waze pick their own roads, which may differ.":
      "Google Maps sigue esta ruta por algunos puntos. Apple Maps y Waze eligen sus propias vías, que pueden ser distintas.",
    "Shared start": "Salida compartida",
    "Shared destination": "Destino compartido",
    // ---- vehicles, jump bar, best time preview ----
    "Results": "Resultados",
    "Chart": "Gráfica",
    "Gas": "Gasolina",
    "Best time": "Mejor hora",
    "Map": "Mapa",
    "Jump to a section": "Ir a una sección",
    "Name": "Nombre",
    "Give the vehicle a name.": "Póngale un nombre al vehículo.",
    "Kept in this browser only.": "Se guarda solo en este navegador.",
    "Fuel": "Combustible",
    "Diesel": "Diésel",
    "Cancel": "Cancelar",
    "Save": "Guardar",
    "Edit": "Editar",
    "Edit vehicle": "Editar vehículo",
    "Edit {name}": "Editar {name}",
    "Remove {name}": "Quitar {name}",
    "{mpg} mpg": "{mpg} mpg",
    "{price}/gal": "{price}/gal",
    "{miles} mi": "{miles} mi",
    "Gas price per gallon": "Precio de la gasolina por galón",
    "Diesel price per gallon": "Precio del diésel por galón",
    "Defaults: {mpg} mpg, {price} a gallon. Change them to match your vehicle.": "Valores predeterminados: {mpg} mpg, {price} el galón. Cámbielos según su vehículo.",
    "Saved with “{name}”: changes here update it.": "Guardado con “{name}”: los cambios aquí lo actualizan.",
    "Updated “{name}” ({summary}).": "Se actualizó “{name}” ({summary}).",
    "Compare leaving at other times: trip time, tolls and time saved for each. A time that takes a different route can be shown on the map.": "Compare salir a otras horas: tiempo de viaje, peajes y tiempo ahorrado en cada una. Una hora que toma otra ruta se puede ver en el mapa.",
    "Checks {n} times, every {step} minutes.": "Revisa {n} horas, cada {step} minutos.",
    "Up to 12 hours.": "Hasta 12 horas.",
    "No times to check in that window (times already past are skipped).": "No hay horas que revisar en ese intervalo (las horas que ya pasaron se omiten).",
    "Tap a time to see its toll route on the map.": "Toque una hora para ver su ruta con peaje en el mapa.",
    "Show the {time} toll route on the map": "Mostrar en el mapa la ruta con peaje de las {time}",
    "Leaving {time}: toll route": "Saliendo a las {time}: ruta con peaje",
    "Use this time": "Usar esta hora",
    "Different route": "Otra ruta",
    "{time}: different route. Show it on the map": "{time}: otra ruta. Mostrarla en el mapa",
    "Tap a time marked “Different route” to see it on the map.": "Toque una hora marcada “Otra ruta” para verla en el mapa.",
    "Back to your trip": "Volver a su viaje",
    "different roads from your trip": "otras vías que su viaje",
    "same roads as your trip": "las mismas vías que su viaje",
    "Same roads as your trip; the dashed line on the map is this time's route.": "Las mismas vías que su viaje; la línea punteada del mapa es la ruta a esta hora.",
    "The dashed line on the map is a different route from your trip's.": "La línea punteada del mapa es una ruta distinta a la de su viaje.",
    "Same tolls as your trip.": "Los mismos peajes que su viaje.",
    "{name}: not on this route": "{name}: no está en esta ruta",
    "{name}: {price} (not on your trip)": "{name}: {price} (no está en su viaje)",
    "{name}: {was} → {now}": "{name}: {was} → {now}",
    "Default prices: {area} average for the week of {date} (U.S. Energy Information Administration).": "Precios predeterminados: promedio de {area} en la semana del {date} (Administración de Información Energética de EE. UU.).",
    "Houston": "Houston",
    "Tap to change.": "Toque para cambiar.",
    "Theme: automatic ({theme} now)": "Tema: automático ({theme} ahora)",
    "Theme: dark": "Tema: oscuro",
    "Theme: light": "Tema: claro",
    "dark": "oscuro",
    "light": "claro",
    "Language": "Idioma",
    "{h} hr {m} min": "{h} h {m} min",
    "{m} min": "{m} min",
    "{h} hr": "{h} h"
  };

  var LANGS = [["en", "English", "EN", "en-US"], ["es", "Español", "ES", "es-US"], ["vi", "Tiếng Việt", "VI", "vi-VN"],
    ["zh-Hans", "简体中文", "简", "zh-CN"], ["zh-Hant", "繁體中文", "繁", "zh-TW"]];
  var CODES = LANGS.map(function (x) { return x[0]; });
  var DICT = { es: ES };
  function pick(l) {
    if (!l) return null;
    var low = String(l).toLowerCase();
    for (var i = 0; i < CODES.length; i++) if (CODES[i].toLowerCase() === low) return CODES[i];
    if (low === "zh-cn" || low === "zh-sg" || low === "zh") return "zh-Hans";
    if (low === "zh-tw" || low === "zh-hk" || low === "zh-mo") return "zh-Hant";
    return null;
  }
  var params = new URLSearchParams(location.search);
  var stored = null;
  try { stored = localStorage.getItem("htc-lang"); } catch (e) { /* not kept */ }
  var lang = pick(params.get("lang")) || pick(stored) || "en";
  var tempLang = null; // withLang(): e.g. the PDF stays in English for Vietnamese and Chinese

  function cur() { return tempLang || lang; }
  function t(en, vars) {
    var d = DICT[cur()];
    var s = d && Object.prototype.hasOwnProperty.call(d, en) ? d[en] : en;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] == null ? m : vars[k]; });
    return s;
  }

  // Fixed page text: remember each node's English and swap it in place.
  var original = new WeakMap(), ATTRS = ["aria-label", "placeholder", "title", "label"];
  function norm(s) { return s.replace(/\s+/g, " ").trim(); }
  function skip(el) { return el.closest && el.closest("#debug, .esri-ui, .esri-view-surface, script, style, svg, #map .esri-attribution, [data-no-translate]"); }
  function say(en) { var d = DICT[lang]; return d && Object.prototype.hasOwnProperty.call(d, en) ? d[en] : en; }
  function apply(rootEl) {
    rootEl = rootEl || document.body;
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null), node, list = [];
    while ((node = walker.nextNode())) list.push(node);
    list.forEach(function (n) {
      if (!n.parentElement || skip(n.parentElement)) return;
      if (!original.has(n)) { var k = norm(n.nodeValue); if (!k || !ES[k]) return; original.set(n, { text: k, raw: n.nodeValue }); }
      var o = original.get(n);
      n.nodeValue = lang === "en" ? o.raw : o.raw.replace(/\S[\s\S]*\S|\S/, say(o.text));
    });
    Array.prototype.forEach.call(rootEl.querySelectorAll("*"), function (el) {
      if (skip(el)) return;
      ATTRS.forEach(function (a) {
        var key = "data-en-" + a, v = el.getAttribute(a);
        if (v == null) return;
        var en = el.getAttribute(key);
        if (en == null) { if (!ES[norm(v)]) return; el.setAttribute(key, v); en = v; }
        el.setAttribute(a, lang === "en" ? en : say(norm(en)));
      });
    });
    document.documentElement.lang = lang;
    document.title = t("Toll Calculator");
  }

  // Vietnamese and Chinese load when first picked, from the same folder and version as this file.
  var me = document.currentScript && document.currentScript.src || "";
  var base = me.replace(/lang\.js(\?.*)?$/, ""), ver = (me.match(/\?.*$/) || [""])[0];
  var loading = {};
  function load(l) {
    if (DICT[l] || l === "en") return Promise.resolve();
    if (loading[l]) return loading[l];
    loading[l] = new Promise(function (ok) {
      var sc = document.createElement("script");
      sc.src = base + "lang-" + l.toLowerCase() + ".js" + ver;
      sc.onload = function () { ok(); };
      sc.onerror = function () { delete loading[l]; ok(); };
      document.head.appendChild(sc);
    });
    return loading[l];
  }

  var listeners = [];
  function changed() {
    apply();
    listeners.forEach(function (f) { try { f(lang); } catch (e) { console.warn(e); } });
  }
  function setLang(l) {
    lang = pick(l) || "en";
    try { localStorage.setItem("htc-lang", lang); } catch (e) { /* not kept */ }
    var want = lang;
    return load(lang).then(function () { if (lang === want) changed(); });
  }
  if (lang !== "en" && !DICT[lang]) load(lang).then(function () { if (DICT[lang]) changed(); });
  root.I18N = {
    t: t, apply: apply, setLang: setLang,
    get lang() { return cur(); },
    langs: LANGS,
    locale: function () { var c = cur(); for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === c) return LANGS[i][3]; return "en-US"; },
    add: function (code, dict) { DICT[code] = dict; },
    // Runs fn with another language for t() and locale(), without touching the page.
    withLang: function (l, fn) { var was = tempLang; tempLang = pick(l); try { return fn(); } finally { tempLang = was; } },
    onChange: function (f) { listeners.push(f); },
    ES: ES
  };
})(this);
