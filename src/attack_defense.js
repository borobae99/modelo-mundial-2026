/* ============================================================
   attack_defense.js — Ratings ataque/defensa (GENERADO, roadmap 3)
   ------------------------------------------------------------
   NO editar a mano. Lo genera scripts/build_attack_defense.py por
   máxima verosimilitud sobre el histórico martj42. ATK alto = mejor
   ataque; DEF alto = peor defensa (encaja más), DEF baja = sólida.
   Modelo: lambda = AD_GAMMA * (AD_HADV si local no-neutral) * ATK * DEF_rival.
   Lo consume engine.js (modo AD_ON). Claves en español.
   ============================================================ */
const AD_META={source:"martj42/international_results",asof:"2026-06-01",halflife_days:730,window_years:12};
const AD_GAMMA=1.1537, AD_HADV=1.2921;
const AD_RATINGS={
  "Alemania":{atk:2.862,def:0.479},
  "Arabia Saudi":{atk:1.278,def:0.583},
  "Argelia":{atk:2.185,def:0.511},
  "Argentina":{atk:2.988,def:0.245},
  "Australia":{atk:2.036,def:0.417},
  "Austria":{atk:1.965,def:0.497},
  "Belgica":{atk:2.426,def:0.458},
  "Bosnia":{atk:1.214,def:0.757},
  "Brasil":{atk:3.033,def:0.337},
  "Cabo Verde":{atk:1.311,def:0.644},
  "Canada":{atk:1.948,def:0.487},
  "Colombia":{atk:2.831,def:0.369},
  "Corea del Sur":{atk:2.043,def:0.531},
  "Costa de Marfil":{atk:1.652,def:0.464},
  "Croacia":{atk:2.178,def:0.452},
  "Curazao":{atk:1.151,def:0.859},
  "Ecuador":{atk:1.759,def:0.301},
  "Egipto":{atk:1.552,def:0.440},
  "Escocia":{atk:1.709,def:0.590},
  "España":{atk:3.299,def:0.335},
  "Estados Unidos":{atk:1.969,def:0.546},
  "Francia":{atk:2.705,def:0.365},
  "Ghana":{atk:1.422,def:0.668},
  "Haiti":{atk:1.566,def:0.861},
  "Inglaterra":{atk:2.572,def:0.313},
  "Irak":{atk:1.325,def:0.570},
  "Iran":{atk:2.105,def:0.477},
  "Japon":{atk:2.515,def:0.386},
  "Jordania":{atk:1.759,def:0.687},
  "Marruecos":{atk:2.068,def:0.271},
  "Mexico":{atk:1.880,def:0.409},
  "Noruega":{atk:2.446,def:0.507},
  "Nueva Zelanda":{atk:1.690,def:0.561},
  "Paises Bajos":{atk:2.733,def:0.458},
  "Panama":{atk:1.673,def:0.696},
  "Paraguay":{atk:1.589,def:0.435},
  "Portugal":{atk:2.834,def:0.394},
  "Qatar":{atk:1.509,def:0.872},
  "RD Congo":{atk:1.363,def:0.447},
  "Rep. Checa":{atk:1.692,def:0.634},
  "Senegal":{atk:2.104,def:0.416},
  "Sudafrica":{atk:1.394,def:0.617},
  "Suecia":{atk:2.010,def:0.649},
  "Suiza":{atk:2.328,def:0.492},
  "Tunez":{atk:1.542,def:0.453},
  "Turquia":{atk:2.074,def:0.620},
  "Uruguay":{atk:2.013,def:0.318},
  "Uzbekistan":{atk:1.520,def:0.426},
};
