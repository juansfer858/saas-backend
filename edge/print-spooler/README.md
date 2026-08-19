# VantixGC Local ESC/POS Spooler

Local-only print bridge for restaurant/kitchen/bar printers. It runs on a PC/device inside the establishment LAN; it is not a cloud-to-LAN proxy.

Environment:
- `SPOOLER_HOST` default `127.0.0.1`.
- `SPOOLER_PORT` default `18787`.
- `SPOOLER_SHARED_TOKEN` optional but recommended when binding beyond loopback.

Run with Node 22:

`node edge/print-spooler/server.js`

Health: `GET /health`.

Print one: `POST /print` with `{ "target": {"host":"192.168.1.50","port":9100}, "job": {"title":"COCINA","lines":[{"quantity":2,"name":"Hamburguesa"}]}}`.

Directed batch: `POST /print/batch` with `{ "entries": [...] }`. The Core endpoint `/api/v1/impresion/trabajos-dirigidos` resolves configured station roles (COCINA/BARRA/etc.) into these local target jobs.

The agent uses RAW TCP + ESC/POS and does not make an internet request to send a job to the printer. Physical printer compatibility must still be validated with the actual printer model at the site.
