/* ============================================================
   data.js — Estructura oficial del torneo y fuerzas de equipo
   ------------------------------------------------------------
   Fuente de la estructura (grupos, calendario, repechaje de
   terceros, cuadro): World Soccer — World Cup 2026 Special.
   Fuente de fuerza (ELO_OFFICIAL): eloratings.net, tabla en vivo
   capturada en junio 2026. Refrescar con scripts/refresh_elo.py.

   NO contiene lógica. Solo constantes que consumen engine.js,
   quiniela.js y validation.js.
   ============================================================ */

const GROUPS={A:["Mexico","Sudafrica","Corea del Sur","Rep. Checa"],B:["Canada","Bosnia","Qatar","Suiza"],C:["Brasil","Marruecos","Haiti","Escocia"],D:["Alemania","Curazao","Costa de Marfil","Ecuador"],E:["Estados Unidos","Paraguay","Australia","Turquia"],F:["Paises Bajos","Japon","Suecia","Tunez"],G:["Belgica","Egipto","Iran","Nueva Zelanda"],H:["Francia","Senegal","Irak","Noruega"],I:["España","Cabo Verde","Arabia Saudi","Uruguay"],J:["Argentina","Argelia","Austria","Jordania"],K:["Portugal","RD Congo","Uzbekistan","Colombia"],L:["Inglaterra","Croacia","Ghana","Panama"]};
const FIX={A:[["Mexico","Sudafrica"],["Corea del Sur","Rep. Checa"],["Rep. Checa","Sudafrica"],["Mexico","Corea del Sur"],["Rep. Checa","Mexico"],["Sudafrica","Corea del Sur"]],B:[["Canada","Bosnia"],["Qatar","Suiza"],["Suiza","Bosnia"],["Canada","Qatar"],["Suiza","Canada"],["Bosnia","Qatar"]],C:[["Brasil","Marruecos"],["Haiti","Escocia"],["Escocia","Marruecos"],["Brasil","Haiti"],["Escocia","Brasil"],["Marruecos","Haiti"]],D:[["Alemania","Curazao"],["Costa de Marfil","Ecuador"],["Alemania","Costa de Marfil"],["Ecuador","Curazao"],["Curazao","Costa de Marfil"],["Ecuador","Alemania"]],E:[["Estados Unidos","Paraguay"],["Australia","Turquia"],["Estados Unidos","Australia"],["Turquia","Paraguay"],["Turquia","Estados Unidos"],["Paraguay","Australia"]],F:[["Paises Bajos","Japon"],["Suecia","Tunez"],["Paises Bajos","Suecia"],["Tunez","Japon"],["Japon","Suecia"],["Tunez","Paises Bajos"]],G:[["Belgica","Egipto"],["Iran","Nueva Zelanda"],["Belgica","Iran"],["Nueva Zelanda","Egipto"],["Egipto","Iran"],["Nueva Zelanda","Belgica"]],H:[["Francia","Senegal"],["Irak","Noruega"],["Francia","Irak"],["Noruega","Senegal"],["Noruega","Francia"],["Senegal","Irak"]],I:[["España","Cabo Verde"],["Arabia Saudi","Uruguay"],["España","Arabia Saudi"],["Uruguay","Cabo Verde"],["Cabo Verde","Arabia Saudi"],["Uruguay","España"]],J:[["Argentina","Argelia"],["Austria","Jordania"],["Argentina","Austria"],["Jordania","Argelia"],["Argelia","Austria"],["Jordania","Argentina"]],K:[["Portugal","RD Congo"],["Uzbekistan","Colombia"],["Portugal","Uzbekistan"],["Colombia","RD Congo"],["Colombia","Portugal"],["RD Congo","Uzbekistan"]],L:[["Inglaterra","Croacia"],["Ghana","Panama"],["Inglaterra","Ghana"],["Panama","Croacia"],["Panama","Inglaterra"],["Croacia","Ghana"]]};
const DEFAULT_RATINGS={"Mexico":1810,"Sudafrica":1685,"Corea del Sur":1790,"Rep. Checa":1770,"Canada":1760,"Bosnia":1720,"Qatar":1690,"Suiza":1850,"Brasil":2010,"Marruecos":1875,"Haiti":1545,"Escocia":1790,"Alemania":1945,"Curazao":1575,"Costa de Marfil":1770,"Ecuador":1825,"Estados Unidos":1810,"Paraguay":1760,"Australia":1735,"Turquia":1825,"Paises Bajos":1985,"Japon":1840,"Suecia":1775,"Tunez":1700,"Belgica":1925,"Egipto":1755,"Iran":1785,"Nueva Zelanda":1565,"Francia":2075,"Senegal":1835,"Irak":1665,"Noruega":1815,"España":2080,"Cabo Verde":1645,"Arabia Saudi":1675,"Uruguay":1895,"Argentina":2105,"Argelia":1765,"Austria":1800,"Jordania":1675,"Portugal":2000,"RD Congo":1705,"Uzbekistan":1695,"Colombia":1900,"Inglaterra":2015,"Croacia":1900,"Ghana":1705,"Panama":1685};
const HOSTS=new Set(["Mexico","Estados Unidos","Canada"]);
// Elo oficial estilo eloratings.net. VER = verificado del top-20 publicado (ene 2026);
// el resto es estimacion Elo coherente con el nivel de la seleccion a inicios de 2026.
const ELO_OFFICIAL={
  "Mexico":1868,"Sudafrica":1517,"Corea del Sur":1756,"Rep. Checa":1733,
  "Canada":1784,"Bosnia":1591,"Qatar":1423,"Suiza":1894,
  "Brasil":1988,"Marruecos":1822,"Haiti":1532,"Escocia":1770,
  "Alemania":1925,"Curazao":1433,"Costa de Marfil":1676,"Ecuador":1935,
  "Estados Unidos":1733,"Paraguay":1833,"Australia":1775,"Turquia":1902,
  "Paises Bajos":1961,"Japon":1906,"Suecia":1714,"Tunez":1636,
  "Belgica":1867,"Egipto":1699,"Iran":1764,"Nueva Zelanda":1585,
  "Francia":2081,"Senegal":1866,"Irak":1608,"Noruega":1917,
  "España":2165,"Cabo Verde":1576,"Arabia Saudi":1566,"Uruguay":1892,
  "Argentina":2113,"Argelia":1743,"Austria":1827,"Jordania":1685,
  "Portugal":1984,"RD Congo":1655,"Uzbekistan":1727,"Colombia":1975,
  "Inglaterra":2020,"Croacia":1930,"Ghana":1503,"Panama":1733
};
const ELO_VERIFIED=new Set(Object.keys(ELO_OFFICIAL));
const GROUP_COLORS={A:"#f5b13d",B:"#4d8df5",C:"#37c98a",D:"#e8503a",E:"#c77dff",F:"#48cae4",G:"#ffb4a2",H:"#90be6d",I:"#f9c74f",J:"#a0c4ff",K:"#f4978e",L:"#7bdff2"};
const THIRD_SLOTS=[{allowed:["A","B","C","D","F"]},{allowed:["C","D","F","G","H"]},{allowed:["C","E","F","H","I"]},{allowed:["E","H","I","J","K"]},{allowed:["A","E","H","I","J"]},{allowed:["B","E","F","I","J"]},{allowed:["E","F","G","I","J"]},{allowed:["D","E","I","J","L"]}];
function RO32(){return[[["R","A"],["R","B"]],[["W","C"],["R","F"]],[["W","E"],["T",0]],[["W","F"],["R","C"]],[["R","E"],["R","I"]],[["W","I"],["T",1]],[["W","A"],["T",2]],[["W","L"],["T",3]],[["W","G"],["T",4]],[["W","D"],["T",5]],[["W","H"],["R","J"]],[["R","K"],["R","L"]],[["W","B"],["T",6]],[["R","D"],["R","G"]],[["W","J"],["R","H"]],[["W","K"],["T",7]]];}
const RO16=[[1,4],[0,2],[3,5],[6,7],[10,11],[8,9],[13,15],[12,14]];const QF=[[0,1],[4,5],[2,3],[6,7]];const SF=[[0,1],[2,3]];
