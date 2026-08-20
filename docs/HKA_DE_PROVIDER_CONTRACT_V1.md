# The Factory HKA — Documento Equivalente provider contract V1

Provider code: `THE_FACTORY_HKA`.

VantixGC integrates the PT behind the existing DIAN outbox; commercial modules do not call HKA directly.

Required encrypted credentials/config supplied during PT onboarding:
- `tokenEmpresa`
- `tokenPassword`
- `documentEquivalentSendUrl`: exact full URL for the PT `EnviarRequest` operation.
- `facturaTemplate`: `FacturaGeneral` template validated with the PT for the tenant/software mode.
- optional `detailTemplate` + `autoBuildDetails` for line generation after the provider mapping has been validated.

The adapter sends JSON `{ tokenEmpresa, tokenPassword, factura }` over HTTPS and parses HKA business/DIAN response fields such as result code, `consecutivoDocumento`, CUFE/CUDE, `tipoCufe`, DIAN validation state/messages and provider response.

Official public HKA documentation publishes the Documento Equivalente REST service, method `EnviarRequest`, Token Empresa/Token Password and the base hosts. VantixGC deliberately does not concatenate an undocumented path onto those base hosts.

Published bases used as reference only:
- Demo/integration: `https://demoapi-de.thefactoryhka.com.co`
- Production / habilitación set transmission: `https://api-de.thefactoryhka.com.co`

Operational gate: code-level adapter installed != tenant habilitated. The restaurant Phase 2 gate requires a real tenant TestSetId/onboarding, actual credentials/template and an accepted Documento Equivalente POS in the DIAN habilitation workflow.
