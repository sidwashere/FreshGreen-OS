const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 6000);
fetch("https://danielstastypetfoods.co.uk/wp-json/wp/v2/users/me", {
  method: 'GET',
  headers: {
    'Authorization': 'Basic 123',
    'User-Agent': 'GreenOpsContentStudio/1.0',
    'Accept': 'application/json'
  },
  signal: controller.signal
}).then(async r => console.log(r.status, await r.text()))
  .catch(e => console.error("ERROR", e))
  .finally(() => clearTimeout(timeout));
