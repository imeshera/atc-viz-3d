const AIRLINES = {
  UAL: 'United',
  AAL: 'American',
  DAL: 'Delta',
  SWA: 'Southwest',
  ASA: 'Alaska',
  JBU: 'JetBlue',
  FFT: 'Frontier',
  NKS: 'Spirit',
  HAL: 'Hawaiian',
  SKW: 'SkyWest',
  ENY: 'Envoy',
  RPA: 'Republic',
  JIA: 'PSA',
  EDV: 'Endeavor',
  ASH: 'Mesa',
  QXE: 'Horizon',
  GJS: 'GoJet',
  CPZ: 'Compass',
  AWI: 'Air Wisconsin',
  PDT: 'Piedmont',
  UCA: 'CommuteAir',
  AAY: 'Allegiant',
  SCX: 'Sun Country',
  VXP: 'Avelo',
  SXV: 'Breeze',
  ACA: 'Air Canada',
  ROU: 'Air Canada Rouge',
  WJA: 'WestJet',
  AMX: 'Aeromexico',
  BAW: 'British Airways',
  DLH: 'Lufthansa',
  AFR: 'Air France',
  KLM: 'KLM',
  UAE: 'Emirates',
  QFA: 'Qantas',
  ANA: 'All Nippon',
  JAL: 'Japan Airlines',
  CPA: 'Cathay Pacific',
  SIA: 'Singapore',
  EVA: 'EVA Air',
  CAL: 'China Airlines',
  CES: 'China Eastern',
  CSN: 'China Southern',
  KAL: 'Korean Air',
  AAR: 'Asiana',
  ICE: 'Icelandair',
  SAS: 'SAS',
  EIN: 'Aer Lingus',
  VIR: 'Virgin Atlantic',
  VOI: 'Volaris',
  AEA: 'American Eagle',
};

const TYPES = {
  B736: '737-600',
  B737: '737-700',
  B738: '737-800',
  B739: '737-900',
  B38M: '737 MAX 8',
  B39M: '737 MAX 9',
  B3XM: '737 MAX 10',
  B752: '757-200',
  B753: '757-300',
  B762: '767-200',
  B763: '767-300',
  B764: '767-400',
  B772: '777-200',
  B77L: '777-200LR',
  B773: '777-300',
  B77W: '777-300ER',
  B788: '787-8',
  B789: '787-9',
  B78X: '787-10',
  B744: '747-400',
  B748: '747-8',
  A19N: 'A319neo',
  A319: 'A319',
  A20N: 'A320neo',
  A320: 'A320',
  A21N: 'A321neo',
  A321: 'A321',
  A332: 'A330-200',
  A333: 'A330-300',
  A339: 'A330-900',
  A359: 'A350-900',
  A35K: 'A350-1000',
  A388: 'A380',
  E170: 'E170',
  E75L: 'E175',
  E75S: 'E175',
  E190: 'E190',
  E195: 'E195',
  E290: 'E190-E2',
  E295: 'E195-E2',
  CRJ2: 'CRJ-200',
  CRJ7: 'CRJ-700',
  CRJ9: 'CRJ-900',
  B712: '717',
  A306: 'A300',
  MD11: 'MD-11',
  B77F: '777F',
};

export function airportCode(code) {
  if (!code) return '';
  const key = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^K[A-Z]{3}$/.test(key)) return key.slice(1);
  return key;
}

export function routeLabel(from, to, airports) {
  const list = Array.isArray(airports) && airports.length ? airports : [from, to];
  const codes = list.map(airportCode).filter(Boolean);
  if (codes.length >= 2) return codes.join(' → ');
  if (codes.length === 1 && from && !to) return `From ${codes[0]}`;
  if (codes.length === 1 && to && !from) return `To ${codes[0]}`;
  return '';
}

export function airlineName(callsign) {
  const letters = String(callsign || '').match(/^[A-Z]{2,3}/);
  if (!letters) return '';
  return AIRLINES[letters[0]] || '';
}

export function typeName(code) {
  if (!code) return '';
  return TYPES[code.toUpperCase()] || code.toUpperCase();
}

export function detailLabel(callsign, info) {
  const parts = [];
  const airline = airlineName(callsign);
  if (airline) parts.push(airline);
  if (info?.type) parts.push(typeName(info.type));
  if (info?.registration) parts.push(info.registration);
  return parts.join(' · ');
}
