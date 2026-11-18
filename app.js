"use strict";

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const CLIMA_URL = "https://api.open-meteo.com/v1/forecast";
const campo = document.querySelector("#ciudad");
const estado = document.querySelector("#estado");
const ubicaciones = document.querySelector("#ubicaciones");
const panel = document.querySelector("#clima");
const reintentar = document.querySelector("#reintentar");
let busquedaActiva;
let climaActivo;
let revision = 0;
let repetir = () => {};

// Construir nodos evita interpretar los nombres recibidos como código HTML.
function nodo(etiqueta, texto, clase) {
  const elemento = document.createElement(etiqueta);
  if (texto !== undefined) elemento.textContent = texto;
  if (clase) elemento.className = clase;
  return elemento;
}
function informar(texto, tipo = "normal") {
  estado.textContent = texto;
  estado.dataset.tipo = tipo;
  reintentar.hidden = tipo !== "error";
}

// fetch no rechaza automáticamente una respuesta HTTP 400 o 500.
async function obtenerJSON(url, control) {
  let agotado = false;
  const reloj = setTimeout(() => { agotado = true; control.abort(); }, 15000);
  try {
    const respuesta = await fetch(url, { signal: control.signal });
    if (!respuesta.ok) {
      if (respuesta.status === 429) throw new Error("Hay demasiadas consultas. Espera un momento y vuelve a intentar.");
      if (respuesta.status === 400) throw new Error("El servicio no pudo interpretar la consulta. Revisa el nombre e inténtalo de nuevo.");
      if (respuesta.status >= 500) throw new Error("El servicio del clima no está disponible por ahora. Inténtalo más tarde.");
      throw new Error("No fue posible consultar el servicio (HTTP " + respuesta.status + ").");
    }
    const datos = await respuesta.json();
    if (!datos || typeof datos !== "object" || datos.error) throw new Error("El servicio devolvió una respuesta inesperada.");
    return datos;
  } catch (error) {
    if (agotado) throw new Error("La consulta tardó demasiado. Revisa tu conexión y vuelve a intentar.");
    if (error.name === "AbortError") throw error;
    if (error instanceof TypeError) throw new Error("No pudimos conectar. Revisa tu conexión a Internet y vuelve a intentar.");
    if (error instanceof SyntaxError) throw new Error("El servicio devolvió datos que no pudimos leer.");
    throw error;
  } finally { clearTimeout(reloj); }
}

function nombreCompleto(ciudad) {
  return [ciudad.name, ciudad.admin1, ciudad.country].filter(Boolean).join(", ");
}
async function buscarCiudad(consulta) {
  const turno = ++revision;
  busquedaActiva?.abort();
  climaActivo?.abort();
  const control = new AbortController();
  busquedaActiva = control;
  panel.replaceChildren();
  ubicaciones.replaceChildren();
  panel.setAttribute("aria-busy", "false");
  repetir = () => buscarCiudad(consulta);
  if (consulta.length < 2) {
    informar("Escribe al menos dos letras para buscar una ciudad.");
    campo.focus();
    return;
  }
  informar("Buscando ciudades…", "carga");
  const parametros = new URLSearchParams({ name: consulta, count: "5", language: "es", format: "json" });
  try {
    const datos = await obtenerJSON(GEO_URL + "?" + parametros, control);
    if (turno !== revision) return;
    if (datos.results !== undefined && !Array.isArray(datos.results)) throw new Error("El servicio devolvió una lista de ciudades inesperada.");
    const ciudades = (datos.results || []).filter(c => c && typeof c.name === "string" && Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
    if (!ciudades.length) {
      informar("No encontramos ciudades con ese nombre. Prueba otra escritura o una ciudad cercana.");
      return;
    }
    ciudades.forEach((ciudad, indice) => {
      const boton = nodo("button", nombreCompleto(ciudad), "ubicacion");
      boton.type = "button";
      boton.dataset.indice = indice;
      boton.setAttribute("aria-pressed", "false");
      boton.addEventListener("click", () => cargarClima(ciudad, indice, turno));
      ubicaciones.append(boton);
    });
    await cargarClima(ciudades[0], 0, turno);
  } catch (error) {
    if (turno === revision && error.name !== "AbortError") informar(error.message, "error");
  }
}

async function cargarClima(ciudad, indice, turno) {
  climaActivo?.abort();
  const control = new AbortController();
  climaActivo = control;
  repetir = () => cargarClima(ciudad, indice, turno);
  panel.replaceChildren();
  panel.setAttribute("aria-busy", "true");
  ubicaciones.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.indice) === indice)));
  informar("Consultando el clima de " + ciudad.name + "…", "carga");
  const parametros = new URLSearchParams({
    latitude: String(ciudad.latitude), longitude: String(ciudad.longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    timezone: "auto", forecast_days: "5", temperature_unit: "celsius", wind_speed_unit: "kmh"
  });
  try {
    const datos = await obtenerJSON(CLIMA_URL + "?" + parametros, control);
    if (turno !== revision || control !== climaActivo) return;
    if (!datos.current || !datos.daily || !Array.isArray(datos.daily.time) || !datos.daily.time.length ||
        !["temperature_2m_max", "temperature_2m_min", "precipitation_probability_max", "weather_code"].every(k => Array.isArray(datos.daily[k]) && datos.daily[k].length === datos.daily.time.length)) {
      throw new Error("La respuesta del clima está incompleta. Vuelve a intentar.");
    }
    mostrarClima(ciudad, datos);
    informar("Consulta lista. Puedes elegir otra ubicación de la lista o buscar una nueva ciudad.");
  } catch (error) {
    if (turno === revision && control === climaActivo && error.name !== "AbortError") informar(error.message, "error");
  } finally {
    if (turno === revision && control === climaActivo) panel.setAttribute("aria-busy", "false");
  }
}

function condicion(codigo) {
  if (codigo === 0) return ["Despejado", "☀"];
  if ([1, 2].includes(codigo)) return ["Parcialmente nublado", "⛅"];
  if (codigo === 3) return ["Nublado", "☁"];
  if ([45, 48].includes(codigo)) return ["Niebla", "≋"];
  if ([51, 53, 55, 56, 57].includes(codigo)) return ["Llovizna", "☂"];
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(codigo)) return ["Lluvia", "☂"];
  if ([71, 73, 75, 77, 85, 86].includes(codigo)) return ["Nieve", "❄"];
  if ([95, 96, 97, 99].includes(codigo)) return ["Tormenta", "ϟ"];
  return ["Condición no disponible", "—"];
}
function numero(valor, unidad = "") {
  return Number.isFinite(valor) ? Math.round(valor).toLocaleString("es-MX") + unidad : "No disponible";
}
function icono(texto, clase) {
  const elemento = nodo("span", texto, clase);
  elemento.setAttribute("aria-hidden", "true");
  return elemento;
}
function mostrarClima(ciudad, datos) {
  const actual = datos.current;
  const [descripcion, simbolo] = condicion(actual.weather_code);
  const bloque = nodo("div", undefined, "actual");
  const principal = nodo("div", undefined, "actual-principal");
  principal.append(nodo("p", "CONDICIONES ACTUALES", "etiqueta"), nodo("h2", ciudad.name),
    nodo("p", [ciudad.admin1, ciudad.country].filter(Boolean).join(" · "), "lugar"));
  const temperatura = nodo("p", numero(actual.temperature_2m), "temperatura");
  if (Number.isFinite(actual.temperature_2m)) temperatura.append(nodo("span", " °C"));
  principal.append(temperatura, nodo("p", descripcion, "descripcion"), icono(simbolo, "icono-grande"));
  const detalles = nodo("dl", undefined, "datos");
  for (const [etiqueta, valor] of [
    ["Sensación térmica", numero(actual.apparent_temperature, " °C")],
    ["Humedad", numero(actual.relative_humidity_2m, "%")],
    ["Viento", numero(actual.wind_speed_10m, " km/h")],
    ["Lluvia hoy · probabilidad máxima", numero(datos.daily.precipitation_probability_max[0], "%")]
  ]) {
    const detalle = nodo("div", undefined, "dato");
    detalle.append(nodo("dt", etiqueta), nodo("dd", valor));
    detalles.append(detalle);
  }
  bloque.append(principal, detalles);
  const hora = typeof actual.time === "string" ? actual.time.replace("T", " · ") : "No disponible";
  panel.append(bloque, nodo("p", "Hora del dato: " + hora + " · " + (datos.timezone || "Zona no disponible"), "hora"));
  const encabezado = nodo("div", undefined, "titulo-pronostico");
  encabezado.append(nodo("h2", "Los próximos cinco días"), nodo("p", "Máxima / mínima · grados Celsius"));
  const dias = nodo("div", undefined, "dias");
  datos.daily.time.slice(0, 5).forEach((fecha, i) => {
    const dia = nodo("article", undefined, "dia");
    const f = new Date(fecha + "T12:00:00Z");
    const [texto, dibujo] = condicion(datos.daily.weather_code[i]);
    const valido = !Number.isNaN(f.getTime());
    dia.append(nodo("h3", i === 0 ? "Hoy" : valido ? f.toLocaleDateString("es-MX", { weekday: "long", timeZone: "UTC" }) : "Día " + (i + 1)),
      nodo("p", valido ? f.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }) : "Fecha no disponible", "fecha"),
      icono(dibujo, "icono"), nodo("p", texto, "condicion"));
    const rango = nodo("p", numero(datos.daily.temperature_2m_max[i], "°"), "rango");
    rango.append(nodo("span", numero(datos.daily.temperature_2m_min[i], "°")));
    dia.append(rango, nodo("p", "Lluvia: " + numero(datos.daily.precipitation_probability_max[i], "%"), "lluvia"));
    dias.append(dia);
  });
  panel.append(encabezado, dias);
}

document.querySelector("#formulario").addEventListener("submit", evento => {
  evento.preventDefault();
  buscarCiudad(campo.value.trim());
});
document.querySelectorAll("[data-ciudad]").forEach(boton => boton.addEventListener("click", () => {
  campo.value = boton.dataset.ciudad;
  buscarCiudad(campo.value);
}));
reintentar.addEventListener("click", () => repetir());
buscarCiudad(campo.value.trim());
