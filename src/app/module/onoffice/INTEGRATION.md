# onOffice integration and deployment

The website reads the MongoDB cache. Synchronization reads onOffice and updates only that cache; it does not change onOffice records.

## Publication policy

Eligible records must have `veroeffentlichen = 1`, `status = 1` and an allowed `status2` marketing status. The default VENTOS statuses are `ind_Schl_2897` (IN VERMIETUNG) and `status2obj_aktiv` (IM VERKAUF). This excludes BESTAND, sold/rented archives and unpublished records without imposing a fixed property count. The saved read-only audit on 16 October 2026 found 233 homepage-marked records, 197 active records, and 137 in these two on-market statuses; these are a dated snapshot, not expected constants.

Set `ONOFFICE_ALLOWED_MARKETING_STATUSES` to a comma-separated list to change the approved policy. `*` explicitly includes every active homepage-marked status. Empty configuration is rejected. Confirm the intended statuses with the project owner before changing this policy.

onOffice's field definitions omit some documented special fields. The integration always requests `Id`, `status`, `veroeffentlichen`, `showGoogleMap`, `verkauft` and `reserviert`; omission from the definitions does not prevent them being read.

## Field mapping

- Rental display price: positive `miete_pauschal`, then positive `warmmiete`, then positive `kaltmiete`. Purchase display price: `kaufpreis` only. A missing price is `null`; purchase prices never become monthly rent.
- `miete_pauschal_pro`: `T` → day, `W` → week, `M` → month. A missing period remains unknown. Warm/cold rent is monthly. Price filters compare the displayed amount in its stated billing interval; they do not invent a conversion between daily, weekly and monthly rents.
- Availability date: `abdatum`, with a valid date in `verfuegbar_ab` as fallback. The original availability text remains `verfuegbarAbText`; text such as “nach Vereinbarung” is not converted into an invented date.
- Occupancy: `ind_1768_Feld_ObjKategorie10` (Vermietungsstatus). Marketing status remains separately available as `status2`/`status2Label`. If occupancy is blank, `verkauft`/`reserviert` provide the fallback offer status.
- German display labels are separate from stored raw enum codes. Fields without a permitted-value dictionary use a separate `formatoutput: true`, `outputlanguage: DEU` read. Numeric data is read without formatting. Districts use these authoritative labels, without ZIP/title inference.
- Map pins use the same eligibility and search filters as the list, require valid coordinates and `showGoogleMap = true`. Records withholding map publication remain in the list without a pin.

## API contract

`GET /api/v1/onoffice/estates` returns `{ data, meta: { total, page, limit } }`. Supported filters: `searchTerm`, `district`, `vermarktungsart` (`miete`/`kauf`), `objektart`, `status`, `minRooms`, `maxRooms`, `minPrice`, `maxPrice`, `minArea`, `maxArea`, `availableFrom`. Maximum page size is 1000.

`GET /api/v1/onoffice/estates/map` accepts the same filters and returns all matching, permitted map pins. `price`, `priceType`, `pricePeriod`, `priceLabel`, `rentalStatusLabel`, `status2Label`, `verfuegbar_ab` and `verfuegbarAbText` are the display fields. Always render a price's actual `pricePeriod`.

Admin-only `GET /api/v1/crm/sync/status` returns `{ data: { total, syncedAt, syncInProgress } }` without starting a sync. Admin-only `POST /api/v1/crm/sync/onoffice` explicitly starts one; check `data.complete` and `data.errors`, including on HTTP 200.

## Rollout and checks

1. Configure the existing estate and picture API credentials through the deployment secret store; never place them in frontend variables or handover documents.
2. Preserve the existing database backup and application logs before deployment. Deploy backend and frontend contracts together. Old cache records need one successful full sync before the new labels/status fields are available; public reads reject missing publication approval.
3. Run one authenticated sync in the deployment environment and verify `complete: true`, zero errors, current source counts under the chosen policy, rental/purchase examples, occupancy, availability and map privacy. No production sync was run by the local tests.
4. Ensure a single persistent scheduler executes the ten-minute job. Nest's in-process scheduler requires a running instance; a serverless host does not guarantee it. Use one worker or authenticated scheduled invocation on such a host. The overlap guard applies within one process; it is not a distributed database lock.

All pages, labels and images are validated before cache writes. Incomplete/malformed API results abort without deactivation. A partial database write failure skips deactivation and reports `complete: false`. A verified successful empty eligible set deactivates stale records. Deactivation changes visibility only; it does not delete stored properties.

Validation: `npm test -- --runInBand` and `npm run build`. Tests use mocked API/database calls and perform no network or production mutation.
