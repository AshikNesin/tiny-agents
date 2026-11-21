import { createServer } from "node:https";
import { readFileSync } from "node:fs";

const [port, cert, key] = process.argv.slice(2);

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Chennai to Goa · Friday</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
  // The dev server runs under tsx, whose esbuild keepNames wraps functions in
  // __name(...). The vault fill's in-page function is serialized into this
  // page with those calls, so the page provides the helper.
  window.__name = (fn) => fn;
</script>
<style>
body{margin:0;font:15px/1.45 system-ui,sans-serif;color:#1d2433;background:#f4f6fa}
header{background:#0b4f8a;color:#fff;padding:14px 24px;font-weight:600}
main{max-width:720px;margin:24px auto;padding:0 16px}
.fare{background:#fff;border-radius:10px;padding:14px 18px;margin:10px 0;display:flex;justify-content:space-between;box-shadow:0 1px 2px #0001}
.fare.best{outline:2px solid #0b8a4f}
.price{font-weight:700}
form{background:#fff;border-radius:10px;padding:16px 18px;margin-top:18px;display:grid;gap:10px}
label{display:grid;gap:4px;font-size:13px;color:#566}
input{font:inherit;padding:8px 10px;border:1px solid #ccd;border-radius:6px}
</style></head>
<body><header>flights.example.com</header><main>
<h1>Chennai (MAA) → Goa (GOI) · Friday</h1>
<div class="fare best"><span>6:15 AM → 7:30 AM · Nonstop</span><span class="price">₹5,840</span></div>
<div class="fare"><span>9:40 AM → 11:00 AM · Nonstop</span><span class="price">₹6,450</span></div>
<div class="fare"><span>2:05 PM → 5:55 PM · 1 stop</span><span class="price">₹7,120</span></div>
<form><strong>Payment · 2 travellers</strong>
<label>Card number<input name="cardnumber" autocomplete="cc-number"></label>
<label>Expiry<input name="exp" autocomplete="cc-exp"></label>
<label>Security code<input name="cvc" autocomplete="cc-csc"></label>
<label>Name on card<input name="ccname" autocomplete="cc-name"></label>
</form></main></body></html>`;

createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
}).listen(Number(port), "127.0.0.1");
