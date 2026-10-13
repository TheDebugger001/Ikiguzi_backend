// Rwanda's 5 provinces (incl. Kigali City) and 30 districts.
// Keep in sync with Mvec_frontend/src/data/rwandaLocations.js.
const RWANDA_LOCATIONS = {
  "Kigali City": ["Gasabo", "Kicukiro", "Nyarugenge"],
  "Northern Province": ["Burera", "Gakenke", "Gicumbi", "Musanze", "Rulindo"],
  "Southern Province": ["Gisagara", "Huye", "Kamonyi", "Muhanga", "Nyamagabe", "Nyanza", "Nyaruguru", "Ruhango"],
  "Eastern Province": ["Bugesera", "Gatsibo", "Kayonza", "Kirehe", "Ngoma", "Nyagatare", "Rwamagana"],
  "Western Province": ["Karongi", "Ngororero", "Nyabihu", "Nyamasheke", "Rubavu", "Rusizi", "Rutsiro"],
};

const PROVINCES = Object.keys(RWANDA_LOCATIONS);
const DISTRICTS = PROVINCES.flatMap((p) => RWANDA_LOCATIONS[p]);

const provinceOfDistrict = (district) =>
  PROVINCES.find((p) => RWANDA_LOCATIONS[p].some((d) => d.toLowerCase() === String(district || "").trim().toLowerCase())) || null;

module.exports = { RWANDA_LOCATIONS, PROVINCES, DISTRICTS, provinceOfDistrict };
