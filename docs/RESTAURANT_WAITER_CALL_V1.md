# Restaurant Waiter Call V1

Client QR assistance is split into two explicit actions:

- `PEDIR AYUDA`: opens the existing ordering instructions.
- `LLAMAR MESERO`: creates one active service call for the current authorized table visit.

Routing contract:

1. The waiter who opened the table receives the call first when that user is an active `MESERO`.
2. Fallback primary resolution is the first waiter-created order, then the table's assigned waiter.
3. If no waiter attends within 20 seconds, the call escalates to all active linked waiter devices.
4. The first waiter who taps `ATENDER` wins atomically. The call disappears from every waiter device and the client can call again.
5. A photographed QR without the current four-digit visit authorization cannot create a waiter call.

Transport:

- Client and waiter surfaces receive changes through SSE.
- Browser code uses no `setInterval` and no `MutationObserver`.
- Server watchers exist only while SSE subscribers are connected and use bounded `setTimeout` scheduling.
